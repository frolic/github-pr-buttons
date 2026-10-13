const input = document.getElementById('token')
const message = document.getElementById('message')

chrome.storage.local.get('token').then(({ token }) => {
	input.value = token ?? ''
})

input.addEventListener('change', async () => {
	const token = input.value.trim()
	if (token) await chrome.storage.local.set({ token })
	else await chrome.storage.local.remove('token')
	message.textContent = 'Saved. Reload the pull request page.'
})
