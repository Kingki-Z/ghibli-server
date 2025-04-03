require('dotenv').config(); // 这行代码要放在文件的顶部

const express = require('express');
const multer = require('multer');
const cors = require('cors');
const fs = require('fs');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

const app = express();
app.use(cors());
app.use(express.json()); // 用于接收 JSON 请求体

const upload = multer({ dest: 'uploads/' });
const replicateApiToken = process.env.REPLICATE_API_TOKEN; // 读取 .env 文件中的变量


// 上传并生成图像
app.post('/upload', upload.single('image'), async (req, res) => {
  const imageData = fs.readFileSync(req.file.path, { encoding: 'base64' });

  try {
    const response = await fetch('https://api.replicate.com/v1/predictions', {
      method: 'POST',
      headers: {
        'Authorization': `Token ${replicateApiToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        version: "407b7fd425e00eedefe7db3041662a36a126f1e4988e6fbadfc49b157159f015", // ghiblify-3
        input: {
          image: `data:image/jpeg;base64,${imageData}`,
          prompt: "recreate this image in ghibli style",
          replicate_weights: "https://replicate.delivery/xezq/kdtoeV1nYVVDKyRqcN4tplVSTaghKU3dqOecgapK5KVwokcUA/trained_model.tar"
        }
      })
    });

    const prediction = await response.json();
    console.log('prediction:', prediction);

    if (prediction?.urls?.get) {
      let result = null;
      let retries = 0;

      while (retries < 20) {
        const resultRes = await fetch(prediction.urls.get, {
          headers: { Authorization: `Token ${replicateApiToken}` }
        });

        result = await resultRes.json();
        console.log(`轮询第 ${retries + 1} 次，状态：`, result.status);

        if (result.status === 'succeeded') {
          // 扣除一次生成次数
          const users = JSON.parse(fs.readFileSync('./users.json', 'utf8'));
          const userId = 'user123';

          if (users[userId]) {
            users[userId].count = Math.max(0, users[userId].count - 1);
          } else {
            users[userId] = { count: 0 };
          }

          fs.writeFileSync('./users.json', JSON.stringify(users, null, 2));

          // 保存历史记录
          const history = JSON.parse(fs.readFileSync('./history.json', 'utf8'));
          if (!history[userId]) {
            history[userId] = [];
          }

          history[userId].unshift({
            url: result.output,
            createdAt: new Date().toISOString()
          });

          fs.writeFileSync('./history.json', JSON.stringify(history, null, 2));

          return res.json({
            success: true,
            resultImageUrl: result.output
          });
        }

        if (result.status === 'failed') {
          return res.json({ success: false, msg: '生成失败' });
        }

        await new Promise(resolve => setTimeout(resolve, 1500));
        retries++;
      }

      return res.json({ success: false, msg: '超时未完成生成' });
    } else {
      return res.json({ success: false, msg: 'Replicate 接口异常' });
    }

  } catch (err) {
    console.error('调用出错', err);
    return res.json({ success: false, msg: '服务器错误' });
  }
});

// 获取生成次数
app.get('/count', (req, res) => {
  const userId = req.query.userId || 'user123'; // 支持传入用户ID
  const users = JSON.parse(fs.readFileSync('./users.json', 'utf8'));
  const count = users[userId]?.count ?? 0;
  res.json({ count });
});

// 临时测试用：重置生成次数为5
app.post('/reset', (req, res) => {
  const userId = req.query.userId || 'user123';
  const users = JSON.parse(fs.readFileSync('./users.json', 'utf8'));

  users[userId] = { count: 5 };
  fs.writeFileSync('./users.json', JSON.stringify(users, null, 2));

  res.json({ success: true, msg: '生成次数已重置为5次' });
});

// 获取历史记录
app.get('/history', (req, res) => {
  const userId = req.query.userId || 'user123';
  const history = JSON.parse(fs.readFileSync('./history.json', 'utf8'));
  res.json(history[userId] || []);
});

// 分享增加一次生成次数
app.post('/share', (req, res) => {
  const userId = req.query.userId || 'user123';
  const users = JSON.parse(fs.readFileSync('./users.json', 'utf8'));

  if (!users[userId]) {
    users[userId] = { count: 0 };
  }

  users[userId].count += 1;
  fs.writeFileSync('./users.json', JSON.stringify(users, null, 2));

  res.json({ success: true, count: users[userId].count });
});

// 删除历史记录
app.post('/delete', (req, res) => {
  const userId = req.query.userId || 'user123';
  const { url } = req.body;

  if (!url) {
    return res.status(400).json({ success: false, msg: '缺少图片地址' });
  }

  const historyPath = './history.json';
  const history = JSON.parse(fs.readFileSync(historyPath, 'utf8'));

  if (!history[userId]) {
    return res.json({ success: false, msg: '用户无历史记录' });
  }

  // 删除对应记录
  history[userId] = history[userId].filter(item => item.url !== url);

  fs.writeFileSync(historyPath, JSON.stringify(history, null, 2));
  res.json({ success: true, msg: '删除成功' });
});

// 启动服务
app.listen(3000, () => {
  console.log('✅ 服务器启动成功：http://localhost:3000');
});
