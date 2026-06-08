#!/usr/bin/env node
/**
 * Cloud Mail MCP Addon
 * 
 * MCP server for LingTai agents to send/receive/search emails via Cloud Mail.
 * Uses existing Cloud Mail APIs: public/emailList (for read/search) and 
 * send-internal (for send/reply).
 * 
 * Environment variables:
 *   CLOUD_MAIL_URL          - Base URL (e.g. https://mail.example.com)
 *   CLOUD_MAIL_ADMIN_EMAIL  - Admin email for public API auth
 *   CLOUD_MAIL_ADMIN_PASS   - Admin password for public API auth
 *   CLOUD_MAIL_API_KEY      - X-API-Key for send-internal
 *   AGENT_EMAIL             - Agent's managed email address
 */

const https = require('https');
const http = require('http');

// ===== Configuration =====
const CLOUD_MAIL_URL = process.env.CLOUD_MAIL_URL || '';
const ADMIN_EMAIL = process.env.CLOUD_MAIL_ADMIN_EMAIL || '';
const ADMIN_PASS = process.env.CLOUD_MAIL_ADMIN_PASS || '';
const API_KEY = process.env.CLOUD_MAIL_API_KEY || '';
const AGENT_EMAIL = process.env.AGENT_EMAIL || '';

if (!CLOUD_MAIL_URL || !ADMIN_EMAIL || !ADMIN_PASS || !API_KEY || !AGENT_EMAIL) {
	console.error(JSON.stringify({
		jsonrpc: '2.0',
		error: { code: -32000, message: 'Missing env vars: CLOUD_MAIL_URL, CLOUD_MAIL_ADMIN_EMAIL, CLOUD_MAIL_ADMIN_PASS, CLOUD_MAIL_API_KEY, AGENT_EMAIL' }
	}));
	process.exit(1);
}

// ===== HTTP Helper =====
function httpRequest(method, path, body, extraHeaders) {
	return new Promise((resolve, reject) => {
		const url = new URL(path, CLOUD_MAIL_URL);
		const options = {
			hostname: url.hostname,
			port: url.port,
			path: url.pathname + url.search,
			method: method,
			headers: { 'Content-Type': 'application/json', ...extraHeaders }
		};
		const lib = url.protocol === 'https:' ? https : http;
		const req = lib.request(options, (res) => {
			let data = '';
			res.on('data', chunk => data += chunk);
			res.on('end', () => {
				try {
					const parsed = JSON.parse(data);
					if (res.statusCode >= 200 && res.statusCode < 300 && parsed.code === 200)
						resolve(parsed.data);
					else
						reject(new Error(parsed.message || `HTTP ${res.statusCode}`));
				} catch (e) {
					reject(new Error(`Parse error: ${data.substring(0,200)}`));
				}
			});
		});
		req.on('error', reject);
		if (body) req.write(JSON.stringify(body));
		req.end();
	});
}

// ===== Auth Token Management =====
let publicToken = null;
let tokenExpiry = 0;

async function ensureToken() {
	if (publicToken && Date.now() < tokenExpiry) return publicToken;
	const result = await httpRequest('POST', '/api/public/genToken',
		{ email: ADMIN_EMAIL, password: ADMIN_PASS });
	publicToken = result.token;
	tokenExpiry = Date.now() + 25 * 60 * 1000; // 25 min
	return publicToken;
}

// Helper for public API calls (uses Authorization header with token)
async function publicApi(method, path, body) {
	const token = await ensureToken();
	return httpRequest(method, path, body, { 'Authorization': token });
}

// Helper for send-internal (uses X-API-Key)
async function internalApi(method, path, body) {
	return httpRequest(method, path, body, { 'X-API-Key': API_KEY });
}

// ===== Tool Implementations =====

const TOOLS = {
	check: {
		description: 'Check for emails in the agent\'s mailbox',
		inputSchema: {
			type: 'object',
			properties: {
				email: { type: 'string', description: 'Email to check (default: AGENT_EMAIL)' },
				unread: { type: 'boolean', description: 'Only new/unread' },
				limit: { type: 'number', description: 'Max results (default: 10)' }
			}
		},
		handler: async (args) => {
			const email = args.email || AGENT_EMAIL;
			const list = await publicApi('POST', '/api/public/emailList', {
				toEmail: email,
				type: 0,  // RECEIVE
				size: args.limit || 10,
				timeSort: 'desc'
			});
			return {
				content: [{
					type: 'text',
					text: JSON.stringify({
						count: list ? list.length : 0,
						emails: (list || []).map(e => ({
							id: e.emailId,
							from: e.sendEmail,
							name: e.sendName,
							subject: e.subject,
							time: e.createTime,
							preview: (e.text || '').substring(0, 150)
						}))
					}, null, 2)
				}]
			};
		}
	},

	read: {
		description: 'Read a specific email by ID',
		inputSchema: {
			type: 'object',
			properties: {
				emailId: { type: 'number', description: 'Email ID' }
			},
			required: ['emailId']
		},
		handler: async (args) => {
			// emailList with the toEmail being the agent and get recent ones, then filter by ID
			// Since emailList doesn't have emailId filter, we get data and scan
			const list = await publicApi('POST', '/api/public/emailList', {
				toEmail: AGENT_EMAIL,
				size: 100,
				timeSort: 'desc'
			});
			const email = (list || []).find(e => e.emailId === args.emailId);
			if (!email) {
				return { content: [{ type: 'text', text: JSON.stringify({ error: 'Email not found' }) }] };
			}
			return {
				content: [{
					type: 'text',
					text: JSON.stringify({
						id: email.emailId,
						from: email.sendEmail,
						name: email.sendName,
						to: email.toEmail,
						subject: email.subject,
						text: email.text,
						content: email.content,
						time: email.createTime
					}, null, 2)
				}]
			};
		}
	},

	send: {
		description: 'Send an internal email to managed mailbox(es)',
		inputSchema: {
			type: 'object',
			properties: {
				sender: { type: 'string', description: 'Sender (default: AGENT_EMAIL)' },
				receiveEmail: { type: 'array', items: { type: 'string' }, description: 'Recipients' },
				subject: { type: 'string', description: 'Subject' },
				content: { type: 'string', description: 'HTML body' },
				text: { type: 'string', description: 'Plain text' },
				name: { type: 'string', description: 'Sender display name' }
			},
			required: ['receiveEmail', 'subject']
		},
		handler: async (args) => {
			const result = await internalApi('POST', '/api/email/send-internal', {
				sender: args.sender || AGENT_EMAIL,
				receiveEmail: args.receiveEmail,
				subject: args.subject,
				content: args.content || '',
				text: args.text || '',
				name: args.name || ''
			});
			return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
		}
	},

	reply: {
		description: 'Reply to an email (reuses send-internal)',
		inputSchema: {
			type: 'object',
			properties: {
				emailId: { type: 'number', description: 'Email ID to reply to' },
				content: { type: 'string', description: 'HTML reply' },
				text: { type: 'string', description: 'Plain text reply' },
				name: { type: 'string', description: 'Sender name' }
			},
			required: ['emailId']
		},
		handler: async (args) => {
			// Read original to extract sender
			const list = await publicApi('POST', '/api/public/emailList', {
				toEmail: AGENT_EMAIL,
				size: 100,
				timeSort: 'desc'
			});
			const original = (list || []).find(e => e.emailId === args.emailId);
			if (!original) {
				return { content: [{ type: 'text', text: JSON.stringify({ error: 'Original email not found' }) }] };
			}
			const result = await internalApi('POST', '/api/email/send-internal', {
				sender: AGENT_EMAIL,
				receiveEmail: [original.sendEmail],
				subject: original.subject ? 'Re: ' + original.subject : 'Re:',
				content: args.content || '',
				text: args.text || '',
				name: args.name || ''
			});
			return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
		}
	},

	search: {
		description: 'Search emails by keyword',
		inputSchema: {
			type: 'object',
			properties: {
				email: { type: 'string', description: 'Email to search (default: AGENT_EMAIL)' },
				query: { type: 'string', description: 'Search keyword' },
				limit: { type: 'number', description: 'Max results (default: 20)' }
			},
			required: ['query']
		},
		handler: async (args) => {
			const email = args.email || AGENT_EMAIL;
			const list = await publicApi('POST', '/api/public/emailList', {
				toEmail: email,
				content: args.query,
				subject: args.query,
				sendEmail: args.query,
				size: args.limit || 20,
				timeSort: 'desc'
			});
			return {
				content: [{
					type: 'text',
					text: JSON.stringify({
						count: list ? list.length : 0,
						results: (list || []).map(e => ({
							id: e.emailId,
							from: e.sendEmail,
							to: e.toEmail,
							subject: e.subject,
							time: e.createTime,
							preview: (e.text || '').substring(0, 150)
						}))
					}, null, 2)
				}]
			};
		}
	}
};

// ===== MCP Protocol =====
let initialized = false;

function sendMsg(msg) { process.stdout.write(JSON.stringify(msg) + '\n'); }

function sendErr(id, code, msg) { sendMsg({ jsonrpc: '2.0', id, error: { code, message: msg } }); }

function handleRequest(req) {
	const { id, method, params } = req;

	if (method === 'initialize') {
		initialized = true;
		sendMsg({
			jsonrpc: '2.0', id,
			result: {
				protocolVersion: '0.1.0',
				capabilities: { tools: {} },
				serverInfo: { name: 'cloud-mail-mcp', version: '1.0.0' }
			}
		});
		// Auto-initialize token (async, don't block)
		ensureToken().catch(() => {});
		return;
	}

	if (method === 'notifications/initialized') return;
	if (method === 'notifications/cancelled') return;

	if (method === 'tools/list') {
		sendMsg({
			jsonrpc: '2.0', id,
			result: {
				tools: Object.entries(TOOLS).map(([name, def]) => ({
					name, description: def.description, inputSchema: def.inputSchema
				}))
			}
		});
		return;
	}

	if (method === 'tools/call') {
		const { name, arguments: args } = params;
		const tool = TOOLS[name];
		if (!tool) return sendErr(id, -32601, `Tool not found: ${name}`);

		tool.handler(args || {})
			.then(r => sendMsg({ jsonrpc: '2.0', id, result: r }))
			.catch(e => sendErr(id, -32000, e.message));
		return;
	}

	if (method === 'ping') {
		sendMsg({ jsonrpc: '2.0', id, result: {} });
		return;
	}

	sendErr(id, -32601, `Unknown method: ${method}`);
}

// ===== Main Loop =====
const readline = require('readline');
const rl = readline.createInterface({ input: process.stdin, terminal: false });
rl.on('line', line => { try { handleRequest(JSON.parse(line.trim())); } catch (e) { /* ignore parse errors */ } });
rl.on('close', () => process.exit(0));
