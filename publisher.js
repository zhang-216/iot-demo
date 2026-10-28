require('dotenv').config();

const path = require('path');
const express = require('express');
const mqtt = require('mqtt');
const sqlite3 = require('sqlite3').verbose();

const brokerUrl = process.env.MQTT_BROKER || 'mqtt://localhost:1883';
const topic = process.env.MQTT_TOPIC || 'iot/demo/temperature';
const port = Number(process.env.PORT) || 3000;
const publishInterval = 2000;
const maxPoints = 60;
const dbPath = path.join(__dirname, 'iot_history.db');

// ---------- Express ----------
const app = express();
const readings = [];
const sseClients = new Set();
let insertStmt = null;
let mqttClient = null;
let connected = false;

function sendEvent(res, event, payload) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
}

function broadcast(event, payload) {
  for (const res of sseClients) sendEvent(res, event, payload);
}

function statusPayload() {
  return {
    connected,
    mockMode: !connected,
    broker: brokerUrl,
    topic,
  };
}

app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/readings', (req, res) => {
  res.json({
    broker: brokerUrl,
    topic,
    connected,
    mockMode: !connected,
    readings,
  });
});

app.get('/api/history', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 500, 5000);
  const offset = parseInt(req.query.offset, 10) || 0;

  db.all(
    'SELECT * FROM sensor_readings ORDER BY timestamp DESC LIMIT ? OFFSET ?',
    [limit, offset],
    (err, rows) => {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }
      res.json({ count: rows.length, rows });
    }
  );
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
  console.log(`[server] Express 已启动: http://localhost:${port}`);
});

// ---------- SQLite ----------
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('[db] 打开数据库失败:', err.message);
    bootstrap();
  } else {
    console.log(`[db] 已连接 ${dbPath}`);
  }
});

db.serialize(() => {
  db.run(
    `CREATE TABLE IF NOT EXISTS sensor_readings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      temperature REAL NOT NULL,
      humidity    REAL NOT NULL,
      timestamp   TEXT NOT NULL
    )`,
    function (err) {
      if (err) {
        console.error('[db] 建表失败:', err.message);
      } else {
        console.log('[db] 表 sensor_readings 就绪');
        insertStmt = db.prepare(
          'INSERT INTO sensor_readings (temperature, humidity, timestamp) VALUES (?, ?, ?)'
        );
        insertStmt.on('error', (e) => console.error('[db] 写入失败:', e.message));
        console.log('[db] INSERT 语句已准备');
      }
      bootstrap();
    }
  );
});

function persistReading(reading) {
  if (!insertStmt) return;
  insertStmt.run(reading.temperature, reading.humidity, reading.timestamp);
}

function trackAndBroadcast(reading) {
  readings.push(reading);
  if (readings.length > maxPoints) readings.shift();
  persistReading(reading);
  broadcast('reading', reading);
}

// ---------- MQTT + 数据生成 ----------
function bootstrap() {
  startDataLoop();
  startMqtt();
}

// 数据生成循环：MQTT 在就发布，不在就直接入库
function startDataLoop() {
  console.log(`[loop] 数据生成循环已启动（每 ${publishInterval / 1000}s 一条）`);

  setInterval(() => {
    const reading = {
      temperature: +(Math.random() * 30 + 10).toFixed(2),
      humidity:    +(Math.random() * 40 + 30).toFixed(2),
      timestamp:   new Date().toISOString(),
    };

    if (connected && mqttClient) {
      mqttClient.publish(topic, JSON.stringify(reading), { qos: 0 }, (err) => {
        if (err) {
          console.error('[mqtt] 发布失败，切换本地入库:', err.message);
          trackAndBroadcast(reading);
        } else {
          console.log(`[mqtt] 已发布: T=${reading.temperature}°C H=${reading.humidity}%`);
        }
      });
    } else {
      // 无 broker → 模拟模式：直接入库
      trackAndBroadcast(reading);
      console.log(`[mock] 本地生成: T=${reading.temperature}°C H=${reading.humidity}%`);
    }
  }, publishInterval);
}

function startMqtt() {
  console.log(`[mqtt] 尝试连接 ${brokerUrl}（无 broker 也可运行，自动进入模拟模式）`);

  mqttClient = mqtt.connect(brokerUrl, {
    connectTimeout: 4000,
    reconnectPeriod: 4000,
  });

  mqttClient.on('connect', () => {
    connected = true;
    console.log(`[mqtt] 已连接到 ${brokerUrl}`);
    broadcast('status', statusPayload());

    mqttClient.subscribe(topic, (err) => {
      if (err) console.error('[mqtt] 订阅失败:', err.message);
      else console.log(`[mqtt] 已订阅主题: ${topic}`);
    });
  });

  mqttClient.on('message', (topicIn, message) => {
    let reading;
    try {
      reading = JSON.parse(message.toString());
    } catch (_) {
      console.warn(`[mqtt] 收到非 JSON 消息: ${message.toString()}`);
      return;
    }

    if (typeof reading.temperature !== 'number' || typeof reading.humidity !== 'number') {
      console.warn('[mqtt] 消息缺少 temperature/humidity 字段，忽略');
      return;
    }

    trackAndBroadcast(reading);
  });

  mqttClient.on('error', (err) => {
    console.error('[mqtt] 错误:', err.message);
  });

  mqttClient.on('reconnect', () => {
    console.log('[mqtt] 正在重连...');
  });

  mqttClient.on('offline', () => {
    if (connected) {
      connected = false;
      console.log('[mqtt] 连接已断开，已进入模拟模式');
      broadcast('status', statusPayload());
    }
  });

  mqttClient.on('close', () => {
    if (connected) {
      connected = false;
      console.log('[mqtt] 连接关闭，已进入模拟模式');
      broadcast('status', statusPayload());
    }
  });
}

process.on('SIGINT', () => {
  console.log('\n[shutdown] 正在退出...');
  for (const res of sseClients) res.end();
  server.close();
  if (insertStmt) insertStmt.finalize();
  db.close((err) => {
    if (err) console.error('[db] 关闭失败:', err.message);
  });
  if (mqttClient) mqttClient.end();
  process.exit(0);
});
