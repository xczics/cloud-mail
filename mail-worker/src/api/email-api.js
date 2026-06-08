import app from '../hono/hono';
import emailService from '../service/email-service';
import result from '../model/result';
import userContext from '../security/user-context';
import attService from '../service/att-service';
import BizError from '../error/biz-error';

// 验证 X-API-Key 的辅助函数
function requireApiKey(c) {
	const apiKey = c.req.header('X-API-Key');
	if (!apiKey || apiKey !== c.env.internal_api_key) {
		throw new BizError('Invalid or missing API key', 401);
	}
}

app.get('/email/list', async (c) => {
	const data = await emailService.list(c, c.req.query(), userContext.getUserId(c));
	return c.json(result.ok(data));
});

app.get('/email/latest', async (c) => {
	const list = await emailService.latest(c, c.req.query(), userContext.getUserId(c));
	return c.json(result.ok(list));
});

app.delete('/email/delete', async (c) => {
	await emailService.delete(c, c.req.query(), userContext.getUserId(c));
	return c.json(result.ok());
});

app.get('/email/attList', async (c) => {
	const attList = await attService.list(c, c.req.query(), userContext.getUserId(c));
	return c.json(result.ok(attList));
});

app.post('/email/send', async (c) => {
	const email = await emailService.send(c, await c.req.json(), userContext.getUserId(c));
	return c.json(result.ok(email));
});

app.post('/email/send-internal', async (c) => {
	const email = await emailService.sendInternal(c, await c.req.json());
	return c.json(result.ok(email));
});

app.put('/email/read', async (c) => {
	await emailService.read(c, await c.req.json(), userContext.getUserId(c));
	return c.json(result.ok());
})

// ===== API Key 认证的内部 API =====

// 收件箱列表
app.get('/email/inbox', async (c) => {
	requireApiKey(c);
	const list = await emailService.inbox(c, c.req.query());
	return c.json(result.ok(list));
});

// 读取邮件详情
app.get('/email/read/:emailId', async (c) => {
	requireApiKey(c);
	const emailRow = await emailService.readDetail(c, Number(c.req.param('emailId')));
	return c.json(result.ok(emailRow));
});

// 回复邮件
app.post('/email/reply', async (c) => {
	requireApiKey(c);
	const data = await emailService.replyEmail(c, await c.req.json());
	return c.json(result.ok(data));
});

// 搜索邮件
app.get('/email/search', async (c) => {
	requireApiKey(c);
	const list = await emailService.searchEmails(c, c.req.query());
	return c.json(result.ok(list));
});

