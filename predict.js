require('dotenv').config();

const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const dbPath = path.join(__dirname, 'iot_history.db');
const WINDOW = 5;       // 移动平均窗口大小
const FORECAST = 3;     // 预测未来时间点数量

const db = new sqlite3.Database(dbPath);

db.serialize(() => {
  db.all(
    'SELECT temperature, humidity, timestamp FROM sensor_readings ORDER BY timestamp ASC',
    [],
    (err, rows) => {
      if (err) {
        console.error('读取数据库失败:', err.message);
        db.close();
        process.exit(1);
      }

      if (!rows || rows.length < WINDOW + 1) {
        console.log(`历史数据不足（当前 ${rows ? rows.length : 0} 条，至少需要 ${WINDOW + 1} 条），`);
        console.log('请先运行 publisher.js 采集一会儿数据再试。');
        db.close();
        process.exit(0);
      }

      const temps = rows.map((r) => r.temperature);
      const lastTime = new Date(rows[rows.length - 1].timestamp).getTime();
      // 估算采样间隔（毫秒）：取相邻记录间隔的中位数
      const intervals = [];
      for (let i = 1; i < rows.length; i++) {
        intervals.push(
          new Date(rows[i].timestamp).getTime() -
            new Date(rows[i - 1].timestamp).getTime()
        );
      }
      intervals.sort((a, b) => a - b);
      const stepMs = intervals[Math.floor(intervals.length / 2)];

      // ---- 移动平均 + 趋势 ----
      function sma(arr, end, window) {
        let sum = 0;
        for (let i = end - window + 1; i <= end; i++) sum += arr[i];
        return sum / window;
      }

      // 用最近 WINDOW 个 SMA 估算线性趋势 slope
      const recentSmas = [];
      for (let i = temps.length - WINDOW; i < temps.length; i++) {
        recentSmas.push(sma(temps, i, WINDOW));
      }
      // 最小二乘斜率
      const n = recentSmas.length;
      let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
      for (let i = 0; i < n; i++) {
        sumX += i;
        sumY += recentSmas[i];
        sumXY += i * recentSmas[i];
        sumX2 += i * i;
      }
      const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
      const intercept = (sumY - slope * sumX) / n;

      // 输出报告
      console.log('┌──────────────────────────────────────────────┐');
      console.log('│         IoT 温度预测（移动平均 + 趋势）         │');
      console.log('└──────────────────────────────────────────────┘');
      console.log(`  历史记录     : ${rows.length} 条`);
      console.log(`  移动平均窗口 : ${WINDOW}`);
      console.log(`  采样间隔     : ${(stepMs / 1000).toFixed(1)} s (中位数)`);
      console.log(`  预测点数     : ${FORECAST}`);
      console.log('');

      // 最近 WINDOW 条实际值
      console.log('  最近观测值:');
      const tail = rows.slice(-WINDOW);
      tail.forEach((r, i) => {
        const t = new Date(r.timestamp).toLocaleTimeString('zh-CN', {
          hour12: false,
        });
        console.log(
          `    ${t}  T=${r.temperature.toFixed(2)}°C  H=${r.humidity.toFixed(2)}%`
        );
      });
      console.log('');

      // 趋势诊断
      const direction =
        slope > 0.01 ? '↑ 上升' : slope < -0.01 ? '↓ 下降' : '→ 平稳';
      console.log(
        `  趋势斜率  : ${slope.toFixed(4)} °C / 步   (${direction})`
      );
      const lastSma = sma(temps, temps.length - 1, WINDOW);
      console.log(`  当前 SMA  : ${lastSma.toFixed(2)} °C`);
      console.log('');

      // 预测未来 FORECAST 个点
      console.log('  预测结果:');
      console.log('  ┌─────┬──────────────────────┬──────────────┬──────────────┐');
      console.log('  │ #   │ 时间                 │ 预测温度 °C  │ 算法         │');
      console.log('  ├─────┼──────────────────────┼──────────────┼──────────────┤');

      const labels = ['SMA(平稳)', 'SMA+slope(趋势)', '指数平滑'];
      const alpha = 0.35; // 指数平滑系数
      let expForecast = temps[temps.length - 1];
      for (let i = temps.length - 2; i >= 0; i--) {
        expForecast = alpha * temps[i] + (1 - alpha) * expForecast;
      }

      for (let k = 1; k <= FORECAST; k++) {
        const t = new Date(lastTime + stepMs * k);
        const tStr = t.toLocaleString('zh-CN', {
          hour12: false,
          month: '2-digit',
          day: '2-digit',
        });

        // 方法 1: 纯移动平均
        const predSma = lastSma;
        // 方法 2: 线性趋势外推
        const predTrend = intercept + slope * (n - 1 + k);
        // 方法 3: 指数平滑外推
        const predExp = expForecast + slope * k * 0.5;

        // 综合加权（趋势权重最高）
        const pred = 0.25 * predSma + 0.5 * predTrend + 0.25 * predExp;

        const row = [
          String(k).padStart(3, ' '),
          tStr.padEnd(19, ' '),
          pred.toFixed(2).padStart(12, ' '),
          labels[(k - 1) % labels.length].padEnd(12, ' '),
        ].join(' │ ');
        console.log('  │ ' + row + ' │');
      }
      console.log('  └─────┴──────────────────────┴──────────────┴──────────────┘');
      console.log('');
      console.log('  说明: 综合预测 = 0.25×SMA + 0.5×线性趋势 + 0.25×指数平滑');
      console.log('        本预测仅供参考，非专业气象模型。');

      db.close();
    }
  );
});
