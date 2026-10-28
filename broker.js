// 本地测试用 MQTT broker（基于 aedes）
// 用法：node broker.js  或  npm run broker
// 默认监听 1883 端口，启动后 publisher.js / subscriber.js 即可正常连接
const aedes = require('aedes')();
const server = require('net').createServer(aedes.handle);

const port = Number(process.env.MQTT_PORT) || 1883;

aedes.on('client', (client) => {
  console.log(`[broker] 客户端连接: ${client.id}`);
});

aedes.on('clientDisconnect', (client) => {
  console.log(`[broker] 客户端断开: ${client.id}`);
});

aedes.on('publish', (packet) => {
  if (packet.topic.startsWith('$SYS')) return;
  console.log(`[broker] 转发: ${packet.topic} -> ${packet.payload.length}B`);
});

server.listen(port, () => {
  console.log(`[broker] MQTT 测试 broker 已启动: mqtt://localhost:${port}`);
  console.log('[broker] Ctrl+C 退出');
});

process.on('SIGINT', () => {
  console.log('\n[broker] 正在关闭...');
  server.close(() => process.exit(0));
});
