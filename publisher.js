require('dotenv').config();

const path = require('path');
const express = require('express');
const mqtt = require('mqtt');

const brokerUrl = process.env.MQTT_BROKER || 'mqtt://localhost:1883';
const topic = process.env.MQTT_TOPIC || 'iot/demo/temperature';
const port = Number(process.env.PORT) || 3000;
const publishInterval = 2000;
const maxPoints = 60;

const app = express();
const readings = [];
const sseClients = new Set();

function sendEvent(res, event, payload) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
}

function broadcast(event, payload) {
  for (const res of sseClients) sendEvent(res, event, payload);
}

function statusPayload() {
  return { connected: client.connected, broker: brokerUrl, topic };
}

app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/readings', (req, res) => {
  res.json({
    broker: brokerUrl,
    topic,
    connected: client.connected,
    readings,
  });
});

app.get('/events', (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.flushHeaders();

  sendEvent(res, 'status', statusPayload());
  sseClients.add(res);

  req.on('close', () => sseClients.delete(res));
});

const server = app.listen(port, () => {
  console.log(`[publisher] 可视化界面: http://localhost:${port}`);
});

const client = mqtt.connect(brokerUrl);

client.on('connect', () => {
  console.log(`[publisher] 已连接到 ${brokerUrl}`);
  console.log(`[publisher] 开始向主题 ${topic} 发布消息...`);
  broadcast('status', statusPayload());

  const timer = setInterval(() => {
    const reading = {
      temperature: +(Math.random() * 30 + 10).toFixed(2),
      timestamp: new Date().toISOString(),
    };

    client.publish(topic, JSON.stringify(reading), { qos: 0 }, (err) => {
      if (err) {
        console.error('[publisher] 发布失败:', err);
        return;
      }
      console.log(`[publisher] 已发布: ${JSON.stringify(reading)}`);

      readings.push(reading);
      if (readings.length > maxPoints) readings.shift();

      broadcast('reading', reading);
    });
  }, publishInterval);

  client.once('close', () => clearInterval(timer));
});

client.on('error', (err) => {
  console.error('[publisher] 错误:', err);
  broadcast('status', statusPayload());
});

client.on('reconnect', () => {
  console.log('[publisher] 正在重连...');
});

client.on('offline', () => {
  console.log('[publisher] 连接已断开');
  broadcast('status', statusPayload());
});

process.on('SIGINT', () => {
  for (const res of sseClients) res.end();
  server.close();
  client.end();
  process.exit(0);
});
