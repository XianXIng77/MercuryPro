import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, Type } from '@google/genai';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json({ limit: '10mb' }));

// Helper to get Gemini client
function getGeminiClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return null;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

// API Health Check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// AI Auto Tagging & Categorization Endpoint
app.post('/api/ai/auto-tag', async (req, res) => {
  try {
    const { emails } = req.body;
    if (!Array.isArray(emails) || emails.length === 0) {
      return res.status(400).json({ error: 'Missing emails array' });
    }

    const ai = getGeminiClient();
    if (!ai) {
      // Fallback mock classification if key is missing
      const mockedResults = emails.map((email: any) => {
        const text = `${email.subject} ${email.snippet || ''} ${email.body || ''}`;
        const tags: string[] = [];
        let categoryFolder = '收件箱';

        if (text.includes('发票') || text.includes('账单') || text.includes('付款') || text.includes('Invoice')) {
          tags.push('账单明细');
          categoryFolder = '财务账单';
        }
        if (text.includes('紧急') || text.includes('ASAP') || text.includes('重要') || text.includes('审核')) {
          tags.push('紧急高优');
        }
        if (text.includes('跟进') || text.includes('需求') || text.includes('项目') || text.includes('会议')) {
          tags.push('待处理', '工作项目');
          categoryFolder = '工作项目';
        }
        if (text.includes('订阅') || text.includes('优惠') || text.includes('Newsletter') || text.includes('活动')) {
          tags.push('营销订阅');
        }
        if (tags.length === 0) {
          tags.push('普通沟通');
        }

        return {
          id: email.id,
          tags,
          recommendedFolder: categoryFolder,
          summary: email.snippet || email.subject,
          urgency: tags.includes('紧急高优') ? 'high' : 'normal',
        };
      });
      return res.json({ results: mockedResults, source: 'fallback' });
    }

    const prompt = `请对以下邮件列表进行智能分析，为每封邮件自动生成准确的标签（如：紧急高优、待处理、账单明细、客户跟进、工作项目、营销订阅、个人私信、通知提议等）及推荐存入的文件夹分类（如：工作项目、财务账单、差旅规划、个人私人、收件箱），并提供一句话摘要。
    
邮件数据:
${JSON.stringify(emails.map((e: any) => ({ id: e.id, subject: e.subject, sender: e.sender, snippet: e.snippet || e.body?.slice(0, 200) })))}`;

    const response = await ai.models.generateContent({
      model: 'gemini-3.6-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            results: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  id: { type: Type.STRING },
                  tags: {
                    type: Type.ARRAY,
                    items: { type: Type.STRING },
                  },
                  recommendedFolder: { type: Type.STRING },
                  summary: { type: Type.STRING },
                  urgency: { type: Type.STRING, description: 'high, normal, low' },
                },
                required: ['id', 'tags', 'recommendedFolder', 'summary'],
              },
            },
          },
        },
      },
    });

    const parsed = JSON.parse(response.text || '{}');
    return res.json({ results: parsed.results || [], source: 'gemini' });
  } catch (err: any) {
    console.error('Auto tag error:', err);
    return res.status(500).json({ error: err.message || 'Auto tag failed' });
  }
});

// AI Email Smart Summary & Reply Generator Endpoint
app.post('/api/ai/assistant', async (req, res) => {
  try {
    const { action, email } = req.body;
    if (!email) {
      return res.status(400).json({ error: 'Email content is required' });
    }

    const ai = getGeminiClient();
    if (!ai) {
      if (action === 'summarize') {
        return res.json({
          summary: `【摘要】${email.subject} - 涉及项目与沟通要点，请及时关注相关要求。`,
          keyPoints: ['关注邮件主要事项', '如需跟进请及时回复'],
        });
      } else if (action === 'reply') {
        return res.json({
          replies: [
            '好的，收到！我会尽快处理并回复您详细进展。',
            '感谢通知，相关材料已核对无误，随时保持沟通。',
            '抱歉目前时间上有冲突，建议调整至下周再议，谢谢！',
          ],
        });
      } else {
        return res.json({ result: '已完成智能处理。' });
      }
    }

    if (action === 'summarize') {
      const response = await ai.models.generateContent({
        model: 'gemini-3.6-flash',
        contents: `请对这封邮件进行中文深度总结，提炼出核心要点和待办事项:
主题: ${email.subject}
发件人: ${email.sender}
正文: ${email.body}`,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              summary: { type: Type.STRING },
              keyPoints: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
              actionRequired: { type: Type.BOOLEAN },
            },
            required: ['summary', 'keyPoints'],
          },
        },
      });

      return res.json(JSON.parse(response.text || '{}'));
    } else if (action === 'reply') {
      const response = await ai.models.generateContent({
        model: 'gemini-3.6-flash',
        contents: `基于以下邮件内容，为收件人提供 3 种不同语气的中文快捷回复选项（礼貌肯定、专业跟进、婉拒改期）:
主题: ${email.subject}
正文: ${email.body}`,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              replies: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
            },
            required: ['replies'],
          },
        },
      });

      return res.json(JSON.parse(response.text || '{}'));
    }

    res.status(400).json({ error: 'Unknown action' });
  } catch (err: any) {
    console.error('AI assistant error:', err);
    res.status(500).json({ error: err.message || 'AI assistant error' });
  }
});

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
