// The token never leaves the extension: the content script asks for API calls
// by path, and this worker adds the Authorization header.

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
	if (message.type === 'openOptions') {
		chrome.runtime.openOptionsPage()
		return false
	}
	if (message.type === 'api') {
		api(message.method, message.path, message.body).then(sendResponse, (error) =>
			sendResponse({ status: 0, error: String(error) })
		)
		return true
	}
	return false
})

async function api(method, path, body) {
	const { token } = await chrome.storage.local.get('token')
	if (!token) return { status: 401, error: 'no token' }
	const response = await fetch(`https://api.github.com${path}`, {
		method,
		headers: {
			Accept: 'application/vnd.github+json',
			Authorization: `Bearer ${token}`,
			'X-GitHub-Api-Version': '2022-11-28',
			...(body ? { 'Content-Type': 'application/json' } : {}),
		},
		body: body ? JSON.stringify(body) : undefined,
	})
	const text = await response.text()
	let data = null
	try {
		data = text ? JSON.parse(text) : null
	} catch {
		// Non-JSON bodies only come with errors; the status carries the outcome.
	}
	return { status: response.status, data }
}
