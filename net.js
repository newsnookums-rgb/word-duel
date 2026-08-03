/* Live sync over MQTT-in-a-WebSocket.
 *
 * There is no server of ours anywhere. Two phones meet on a public MQTT
 * broker at a topic derived from the room code, and the game is published
 * there as a RETAINED message — the broker keeps the last one, so whoever
 * opens the room next is handed the current game immediately, even if the
 * other phone is off. Both HiveMQ and EMQX were probed and confirmed to
 * store and replay retained messages.
 *
 * Every publish carries the WHOLE game (a seed plus the move list, a few KB),
 * never a delta. That is what makes a dropped message harmless: the next one
 * re-states everything, so the two phones cannot end up half-applied.
 *
 * This speaks just enough MQTT 3.1.1 to connect, subscribe and publish —
 * about a hundred lines instead of a 150 KB dependency, and every byte of it
 * is auditable here.
 */

const BROKERS = [
  { name: 'HiveMQ', url: 'wss://broker.hivemq.com:8884/mqtt' },
  { name: 'EMQX',   url: 'wss://broker.emqx.io:8084/mqtt' },
];

const TOPIC_ROOT = 'wwfx2';

/* ----------------------------------------------------- packet encoding */

function encodeLength(n) {
  const out = [];
  do {
    let byte = n % 128;
    n = Math.floor(n / 128);
    if (n > 0) byte |= 0x80;
    out.push(byte);
  } while (n > 0);
  return out;
}

function encodeString(s) {
  const bytes = new TextEncoder().encode(s);
  return [(bytes.length >> 8) & 0xff, bytes.length & 0xff, ...bytes];
}

function packet(type, flags, body) {
  return new Uint8Array([(type << 4) | flags, ...encodeLength(body.length), ...body]);
}

function connectPacket(clientId, keepalive) {
  return packet(1, 0, [
    ...encodeString('MQTT'),
    0x04,                       // protocol level 3.1.1
    0x02,                       // clean session
    (keepalive >> 8) & 0xff, keepalive & 0xff,
    ...encodeString(clientId),
  ]);
}

function subscribePacket(id, topic) {
  return packet(8, 2, [(id >> 8) & 0xff, id & 0xff, ...encodeString(topic), 0x00]);
}

function publishPacket(topic, payload, retain) {
  const bytes = new TextEncoder().encode(payload);
  return packet(3, retain ? 1 : 0, [...encodeString(topic), ...bytes]);
}

/* Reads one or more MQTT packets out of a raw frame. */
function parsePackets(buf) {
  const out = [];
  let i = 0;
  while (i < buf.length) {
    const type = buf[i] >> 4;
    const flags = buf[i] & 0x0f;
    let mult = 1, len = 0, j = i + 1;
    while (j < buf.length) {
      len += (buf[j] & 127) * mult;
      mult *= 128;
      if ((buf[j++] & 128) === 0) break;
    }
    if (j + len > buf.length) break;              // packet split across frames
    out.push({ type, flags, body: buf.subarray(j, j + len) });
    i = j + len;
  }
  return { packets: out, consumed: i };
}

function readPublish(body) {
  const topicLen = (body[0] << 8) | body[1];
  const topic = new TextDecoder().decode(body.subarray(2, 2 + topicLen));
  const payload = new TextDecoder().decode(body.subarray(2 + topicLen));
  return { topic, payload };
}

/* ------------------------------------------------------------ the client */

class GameNet {
  constructor({ room, onMessage, onStatus }) {
    this.room = room;
    this.topic = `${TOPIC_ROOT}/${room}/state`;
    this.onMessage = onMessage || (() => {});
    this.onStatus = onStatus || (() => {});
    this.brokerIndex = 0;
    this.ws = null;
    this.connected = false;
    this.pending = null;        // last payload we failed to send
    this.closed = false;
    this.attempt = 0;
    this.tail = new Uint8Array(0);
    this.connect();
  }

  status(s, detail) { this.onStatus(s, detail); }

  connect() {
    if (this.closed) return;
    const broker = BROKERS[this.brokerIndex % BROKERS.length];
    this.status('connecting', broker.name);

    let ws;
    try {
      ws = new WebSocket(broker.url, 'mqtt');
    } catch (e) {
      return this.retry();
    }
    ws.binaryType = 'arraybuffer';
    this.ws = ws;

    const giveUp = setTimeout(() => {
      if (!this.connected) { try { ws.close(); } catch (e) {} }
    }, 12000);

    ws.onopen = () => {
      const id = `wwfx_${Math.random().toString(16).slice(2, 12)}`;
      ws.send(connectPacket(id, 45));
    };

    ws.onmessage = (ev) => {
      const chunk = new Uint8Array(ev.data);
      const merged = new Uint8Array(this.tail.length + chunk.length);
      merged.set(this.tail); merged.set(chunk, this.tail.length);
      const { packets, consumed } = parsePackets(merged);
      this.tail = merged.subarray(consumed);

      for (const p of packets) {
        if (p.type === 2) {                        // CONNACK
          clearTimeout(giveUp);
          if (p.body[1] !== 0) { try { ws.close(); } catch (e) {} return; }
          this.connected = true;
          this.attempt = 0;
          ws.send(subscribePacket(1, this.topic));
          this.status('online', broker.name);
          this.ping = setInterval(() => {
            if (ws.readyState === 1) ws.send(new Uint8Array([0xc0, 0x00]));
          }, 30000);
          if (this.pending) { this.send(this.pending); this.pending = null; }
        } else if (p.type === 3) {                 // PUBLISH
          const { payload } = readPublish(p.body);
          /* An empty payload is how MQTT clears a retained message, and a
           * public topic can carry anything — parse defensively, but let a
           * genuine bug in the handler surface instead of vanishing. */
          let obj = null;
          try { obj = payload ? JSON.parse(payload) : null; } catch (e) { obj = null; }
          if (obj) this.onMessage(obj);
        }
      }
    };

    const down = () => {
      clearTimeout(giveUp);
      clearInterval(this.ping);
      if (this.connected) this.status('offline');
      this.connected = false;
      this.tail = new Uint8Array(0);
      this.retry();
    };
    ws.onclose = down;
    ws.onerror = () => { try { ws.close(); } catch (e) {} };
  }

  retry() {
    if (this.closed) return;
    this.attempt++;
    /* Alternate brokers on repeated failure so one being down is survivable. */
    if (this.attempt % 2 === 0) this.brokerIndex++;
    const wait = Math.min(1000 * Math.pow(1.6, Math.min(this.attempt, 8)), 20000);
    this.status('offline');
    setTimeout(() => this.connect(), wait);
  }

  /* Publishes retained, so the broker holds it for whoever opens next. */
  send(obj) {
    const payload = typeof obj === 'string' ? obj : JSON.stringify(obj);
    if (!this.connected || !this.ws || this.ws.readyState !== 1) {
      this.pending = payload;
      return false;
    }
    try {
      this.ws.send(publishPacket(this.topic, payload, true));
      return true;
    } catch (e) {
      this.pending = payload;
      return false;
    }
  }

  close() {
    this.closed = true;
    clearInterval(this.ping);
    try { this.ws && this.ws.close(); } catch (e) {}
  }
}

if (typeof globalThis !== 'undefined') {
  globalThis.GameNet = GameNet;
  globalThis.NET_BROKERS = BROKERS;
}
