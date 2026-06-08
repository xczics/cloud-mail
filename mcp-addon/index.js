#!/usr/bin/env node
/**
 * Cloud Mail MCP Addon
 * 
 * Implements Model Context Protocol (MCP) over stdio.
 * Provides tools for LingTai agents to send/receive emails via Cloud Mail.
 * 
 * Configuration via environment variables:
 *   CLOUD_MAIL_URL     - Base URL of the Cloud Mail Worker (e.g. https://mail.example.com)
 *   CLOUD_MAIL_API_KEY - X-API-Key for authentication
 *   AGENT_EMAIL        - Default email address for this agent (e.g. myagent@example.com)
 */

const https = require('https');
const http = require('http');

// ===== Configuration =====
const CLOUD_MAIL_URL = process.env.CLOUD_MAIL_URL || '';
const CLOUD_MAIL_API_KEY = process.env.CLOUD_MAIL_API_KEY || '';
const AGENT_EMAIL = process.env.AGENT_EMAIL || '';

if (!CLOUD_MAIL_URL || !CLOUD_MAIL_API_KEY || !AGENT_EMAIL) {
	console.error(JSON.stringify({
		jsonrpc: '2.0',
		error: { code: -32000, message: 'Missing required environment variables. Need: CLOUD_MAIL_URL, CLOUD_MAIL_API_KEY, AGENT_EMAIL' }
	}));
	process.exit(1);
}

// ===== HTTP Helper =====
function apiRequest(method, path, body) {
	return new Promise((resolve, reject) => {
		const url = new URL(path, CLOUD_MAIL_URL);
		const options = {
			hostname: url.hostname,
			port: url.port,
			path: url.pathname + url.search,
			method: method,
			headers: {
				'X-API-Key': CLOUD_MAIL_API_KEY,
				'Content-Type': 'application/json'
			}
		};

		const lib = url.protocol === 'https:' ? https : http;
		const req = lib.request(options, (res) => {
			let data = '';
			res.on('data', chunk => data += chunk);
			res.on('end', () => {
				try {
					const parsed = JSON.parse(data);
					if (res.statusCode >= 200 && res.statusCode < 300 && parsed.code === 200) {
						resolve(parsed.data);
					} else {
						reject(new Error(parsed.message || `HTTP ${res.statusCode}: ${data}`));
					}
				} catch (e) {
					reject(new Error(`Failed to parse response: ${data}`));
				}
			});
		});
		req.on('error', reject);
		if (body) {
			req.write(JSON.stringify(body));
		}
		req.end();
	});
}

// ===== Tool Implementations =====

const TOOLS = {
	check: {
		description: 'Check for new/unread emails in the agent\'s mailbox',
		inputSchema: {
			type: 'object',
			properties: {
				email: {
					type: 'string',
					description: 'Email address to check (default: AGENT_EMAIL)'
				},
				unread: {
					type: 'boolean',
					description: 'Only show unread emails (default: true)'
				},
				limit: {
					type: 'number',
					description: 'Max emails to return (default: 10)'
				}
			}
		},
		handler: async (args) => {
			const email = args.email || AGENT_EMAIL;
			const params = new URLSearchParams({
				email: email,
				unread: args.unread !== false ? 'true' : 'false',
				limit: String(args.limit || 10)
			});
			const emails = await apiRequest('GET', `/api/email/inbox?${params}`);
			return {
				content: [{
					type: 'text',
					text: JSON.stringify({
						count: emails ? emails.length : 0,
						emails: (emails || []).map(e => ({
							id: e.emailId,
							from: e.sendEmail,
							name: e.name,
							subject: e.subject,
							time: e.createTime,
							unread: e.unread === 0,
							preview: (e.text || '').substring(0, 100)
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
				emailId: {
					type: 'number',
					description: 'Email ID to read'
				}
			},
			required: ['emailId']
		},
		handler: async (args) => {
			const email = await apiRequest('GET', `/api/email/read/${args.emailId}`);
			return {
				content: [{
					type: 'text',
					text: JSON.stringify({
						id: email.emailId,
						from: email.sendEmail,
						name: email.name,
						to: email.toEmail,
						subject: email.subject,
						text: email.text,
						content: email.content,
						time: email.createTime,
						status: email.status,
						unread: email.unread === 0,
						attachments: (email.attList || []).map(a => ({
							filename: a.filename,
							size: a.size,
							type: a.mimeType
						}))
					}, null, 2)
				}]
			};
		}
	},

	send: {
		description: 'Send an internal email to another managed mailbox',
		inputSchema: {
			type: 'object',
			properties: {
				sender: {
					type: 'string',
					description: 'Sender email address (default: AGENT_EMAIL)'
				},
				receiveEmail: {
					type: 'array',
					items: { type: 'string' },
					description: 'Recipient email addresses (must be managed domains)'
				},
				subject: {
					type: 'string',
					description: 'Email subject'
				},
				content: {
					type: 'string',
					description: 'HTML content of the email'
				},
				text: {
					type: 'string',
					description: 'Plain text content of the email'
				},
				name: {
					type: 'string',
					description: 'Sender display name'
				}
			},
			required: ['receiveEmail', 'subject']
		},
		handler: async (args) => {
			const result = await apiRequest('POST', '/api/email/send-internal', {
				sender: args.sender || AGENT_EMAIL,
				receiveEmail: args.receiveEmail,
				subject: args.subject,
				content: args.content || '',
				text: args.text || '',
				name: args.name || ''
			});
			return {
				content: [{
					type: 'text',
					text: JSON.stringify({
						emailId: result.emailId,
						status: result.status,
						recipients: result.recipients
					}, null, 2)
				}]
			};
		}
	},

	reply: {
		description: 'Reply to an email',
		inputSchema: {
			type: 'object',
			properties: {
				emailId: {
					type: 'number',
					description: 'ID of the email to reply to'
				},
				content: {
					type: 'string',
					description: 'HTML reply content'
				},
				text: {
					type: 'string',
					description: 'Plain text reply content'
				},
				name: {
					type: 'string',
					description: 'Sender display name'
				}
			},
			required: ['emailId']
		},
		handler: async (args) => {
			const result = await apiRequest('POST', '/api/email/reply', {
				emailId: args.emailId,
				content: args.content || '',
				text: args.text || '',
				name: args.name || ''
			});
			return {
				content: [{
					type: 'text',
					text: JSON.stringify({
						emailId: result.emailId,
						status: result.status,
						to: result.to
					}, null, 2)
				}]
			};
		}
	},

	search: {
		description: 'Search emails by keyword',
		inputSchema: {
			type: 'object',
			properties: {
				email: {
					type: 'string',
					description: 'Email address to search for (default: AGENT_EMAIL)'
				},
				query: {
					type: 'string',
					description: 'Search keyword (matches subject, content, sender)'
				},
				limit: {
					type: 'number',
					description: 'Max results (default: 20)'
				}
			},
			required: ['query']
		},
		handler: async (args) => {
			const email = args.email || AGENT_EMAIL;
			const params = new URLSearchParams({
				email: email,
				query: args.query,
				limit: String(args.limit || 20)
			});
			const emails = await apiRequest('GET', `/api/email/search?${params}`);
			return {
				content: [{
					type: 'text',
					text: JSON.stringify({
						count: emails ? emails.length : 0,
						results: (emails || []).map(e => ({
							id: e.emailId,
							direction: e.type === 0 ? 'received' : 'sent',
							from: e.sendEmail,
							to: e.toEmail,
							subject: e.subject,
							time: e.createTime,
							preview: (e.text || '').substring(0, 100)
						}))
					}, null, 2)
				}]
			};
		}
	}
};

// ===== MCP Protocol Implementation =====

let initialized = false;
let messageId = 0;

function sendMessage(msg) {
	const line = JSON.stringify(msg);
	// MCP protocol uses line-delimited JSON with newline separator
	process.stdout.write(line + '\n');
}

function sendError(id, code, message, data) {
	sendMessage({
		jsonrpc: '2.0',
		id: id,
		error: { code, message, data }
	});
}

function handleRequest(request) {
	const { id, method, params } = request;

	if (method === 'initialize') {
		initialized = true;
		sendMessage({
			jsonrpc: '2.0',
			id: id,
			result: {
				protocolVersion: '0.1.0',
				capabilities: {
					tools: {}
				},
				serverInfo: {
					name: 'cloud-mail-mcp',
					version: '1.0.0'
				}
			}
		});
		return;
	}

	if (method === 'notifications/initialized') {
		return; // No response needed
	}

	if (method === 'tools/list') {
		const toolList = Object.entries(TOOLS).map(([name, def]) => ({
			name: name,
			description: def.description,
			inputSchema: def.inputSchema
		}));
		sendMessage({
			jsonrpc: '2.0',
			id: id,
			result: { tools: toolList }
		});
		return;
	}

	if (method === 'tools/call') {
		const { name, arguments: args } = params;
		const tool = TOOLS[name];
		if (!tool) {
			sendError(id, -32601, `Tool not found: ${name}`);
			return;
		}

		tool.handler(args || {})
			.then(result => {
				sendMessage({
					jsonrpc: '2.0',
					id: id,
					result: result
				});
			})
			.catch(err => {
				sendError(id, -32000, err.message);
			});
		return;
	}

	// Method not found
	sendError(id, -32601, `Method not found: ${method}`);
}

// ===== Main Loop =====
const readline = require('readline');
const rl = readline.createInterface({
	input: process.stdin,
	output: process.stdout,  // We write responses to stdout directly
	terminal: false
});

rl.on('line', (line) => {
	try {
		const request = JSON.parse(line.trim());
		handleRequest(request);
	} catch (e) {
		console.error('Failed to parse request:', line, e.message);
	}
});

rl.on('close', () => {
	process.exit(0);
});
