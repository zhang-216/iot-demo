require('dotenv').config();

const mqtt = require('mqtt');

const brokerUrl = process.env.MQTT_BROKER || 'mqtt://localhost:1883';
const topic = process.env.MQTT_TOPIC || 'iot/demo/temperature';

const client = mqtt.connect(brokerUrl);

client.on('connect', () => {
  console.log(`[subscriber] 已连接到 ${brokerUrl}`);
  client.subscribe(topic, (err) => {
    if (err) {
      console.error('[subscriber] 订阅失败:', err);
    } else {
      console.log(`[subscriber] 已订阅主题: ${topic}`);
    }
  });
});

client.on('message', (topic, message) => {
  console.log(`[subscriber] 收到消息 -> ${topic}: ${message.toString()}`);
});

client.on('error', (err) => {
  console.error('[subscriber] 错误:', err);
});

client.on('reconnect', () => {
  console.log('[subscriber] 正在重连...');
});

client.on('offline', () => {
  console.log('[subscriber] 连接已断开');
});

process.on('SIGINT', () => {
  client.end();
  process.exit(0);
});
