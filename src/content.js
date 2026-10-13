import { parse } from 'yaml'

// Renders the buttons a repo lists in .github/pr-buttons.yml into the pull
// request sidebar, and dispatches their workflows on the PR's head branch.
// Buttons whose `paths` match none of the PR's files sit in a collapsed
// disclosure below the others.
//
// GitHub navigates with Turbo and re-renders sidebar partials live, so the item
// is re-inserted whenever it goes missing; state survives in `current`.

const CONFIG_PATH = '.github/pr-buttons.yml'
const ITEM_ID = 'github-pr-buttons-sidebar-item'
const RUNS_SHOWN = 5
const RUNS_POLL_MS = 10000

const SPINNER = `<svg class="anim-rotate" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true" style="vertical-align: text-bottom"><circle cx="8" cy="8" r="7" stroke="currentColor" stroke-opacity="0.25" stroke-width="2" vector-effect="non-scaling-stroke" fill="none"></circle><path d="M15 8a7.002 7.002 0 00-7-7" stroke="currentColor" stroke-width="2" stroke-linecap="round" vector-effect="non-scaling-stroke"></path></svg>`

function octicon(name, color, path) {
	return `<svg class="octicon octicon-${name} ${color}" width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" style="vertical-align: text-bottom"><path d="${path}"></path></svg>`
}
const DOT = 'M8 4a4 4 0 1 1 0 8 4 4 0 0 1 0-8Z'
const CHECK =
	'M8 16A8 8 0 1 1 8 0a8 8 0 0 1 0 16Zm3.78-9.72a.751.751 0 0 0-.018-1.042.751.751 0 0 0-1.042-.018L6.75 9.19 5.28 7.72a.751.751 0 0 0-1.042.018.751.751 0 0 0-.018 1.042l2 2a.75.75 0 0 0 1.06 0Z'
const X =
	'M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.749.749 0 0 1 1.275.326.749.749 0 0 1-.215.734L9.06 8l3.22 3.22a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215L8 9.06l-3.22 3.22a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z'
const SYNC =
	'M1.705 8.005a.75.75 0 0 1 .834.656 5.5 5.5 0 0 0 9.592 2.97l-1.204-1.204a.25.25 0 0 1 .177-.427h3.646a.25.25 0 0 1 .25.25v3.646a.25.25 0 0 1-.427.177l-1.38-1.38A7.002 7.002 0 0 1 1.05 8.84a.75.75 0 0 1 .656-.834ZM8 2.5a5.487 5.487 0 0 0-4.131 1.869l1.204 1.204A.25.25 0 0 1 4.896 6H1.25A.25.25 0 0 1 1 5.75V2.104a.25.25 0 0 1 .427-.177l1.38 1.38A7.002 7.002 0 0 1 14.95 7.16a.75.75 0 0 1-1.49.178A5.5 5.5 0 0 0 8 2.5Z'
const CROSS =
	'M2.343 13.657A8 8 0 1 1 13.658 2.343 8 8 0 0 1 2.343 13.657ZM6.03 4.97a.751.751 0 0 0-1.042.018.751.751 0 0 0-.018 1.042L6.94 8 4.97 9.97a.749.749 0 0 0 .326 1.275.749.749 0 0 0 .734-.215L8 9.06l1.97 1.97a.749.749 0 0 0 1.275-.326.749.749 0 0 0-.215-.734L9.06 8l1.97-1.97a.749.749 0 0 0-.326-1.275.749.749 0 0 0-.734.215L8 6.94Z'

let current = null

function api(method, path, body) {
	return chrome.runtime.sendMessage({ type: 'api', method, path, body })
}

function prFromLocation() {
	const match = location.pathname.match(/^\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:\/|$)/)
	if (!match) return null
	const [, owner, repo, number] = match
	return { owner, repo, number, key: `${owner}/${repo}#${number}` }
}

function ensure() {
	const target = prFromLocation()
	if (current && current.key !== target?.key) {
		clearTimeout(current.timer)
		current = null
	}
	if (!target) return
	if (!current) {
		current = {
			...target,
			phase: 'loading',
			pending: new Set(),
			errors: {},
			runs: [],
			olderRuns: [],
			runsPending: new Set(),
			runsError: null,
			timer: 0,
		}
		// Turbo restores back/forward visits from a snapshot, which can carry a stale item.
		document.getElementById(ITEM_ID)?.remove()
		load(current)
	}
	const sidebar = document.getElementById('partial-discussion-sidebar')
	if (!sidebar || current.phase === 'loading' || current.phase === 'hidden') return
	if (document.getElementById(ITEM_ID)) return
	const item = document.createElement('div')
	item.id = ITEM_ID
	item.className = 'discussion-sidebar-item'
	const development = sidebar.querySelector(':scope > create-branch')
	if (development) development.after(item)
	else sidebar.append(item)
	render()
}

async function load(state) {
	const { owner, repo, number } = state
	const pr = await api('GET', `/repos/${owner}/${repo}/pulls/${number}`)
	if (state !== current) return
	if (pr.status === 401) return update({ phase: 'setup' })
	if (pr.status !== 200) {
		return update({
			phase: 'error',
			message: `Cannot read this pull request (${pr.status}). Check the token's repository access.`,
		})
	}
	state.pr = pr.data

	const file = await api(
		'GET',
		`/repos/${owner}/${repo}/contents/${CONFIG_PATH}?ref=${pr.data.head.sha}`
	)
	if (state !== current) return
	if (file.status === 404) return update({ phase: 'hidden' })
	if (file.status !== 200)
		return update({ phase: 'error', message: `Cannot read ${CONFIG_PATH} (${file.status}).` })
	try {
		state.config = parseConfig(parse(decodeContent(file.data)))
	} catch (error) {
		return update({ phase: 'error', message: `Invalid ${CONFIG_PATH}: ${error.message}` })
	}
	await checkWorkflows(state)
	if (state !== current) return
	if (state.config.buttons.some((button) => button.paths)) {
		const files = await changedFiles(state)
		if (state !== current) return
		if (!files)
			return update({ phase: 'error', message: 'Cannot read the files this pull request changes.' })
		for (const button of state.config.buttons) {
			button.matched =
				!Array.isArray(button.paths) || files.some((file) => matchesPaths(file, button.paths))
		}
	}
	if (state.config.buttons.length === 0) return update({ phase: 'hidden' })
	update({ phase: 'ready' })
	refreshRuns(state)
}

// Dispatch runs never show in the PR's checks, so the section lists them. A
// run started from the Actions tab on this branch is listed too: the API does
// not say what started a dispatch.
async function refreshRuns(state) {
	clearTimeout(state.timer)
	const { owner, repo, number } = state
	// The head moves when someone pushes while the page is open.
	const [pr, response] = await Promise.all([
		api('GET', `/repos/${owner}/${repo}/pulls/${number}`),
		api(
			'GET',
			`/repos/${owner}/${repo}/actions/runs?branch=${encodeURIComponent(state.pr.head.ref)}&event=workflow_dispatch&per_page=50`
		),
	])
	if (state !== current || response.status !== 200) return
	if (pr.status === 200) state.pr = pr.data
	const paths = new Set(
		state.config.buttons
			.filter((button) => !button.problem)
			.map((button) => `.github/workflows/${button.workflow}`)
	)
	const runs = response.data.workflow_runs.filter((run) => paths.has(run.path))
	const head = state.pr.head.sha
	state.runs = runs.filter((run) => run.head_sha === head).slice(0, RUNS_SHOWN)
	state.olderRuns = runs.filter((run) => run.head_sha !== head).slice(0, RUNS_SHOWN)
	render()
	if ([...state.runs, ...state.olderRuns].some((run) => run.status !== 'completed')) {
		state.timer = setTimeout(() => refreshRuns(state), RUNS_POLL_MS)
	}
}

function decodeContent(file) {
	const bytes = Uint8Array.from(atob(file.content.replace(/\n/g, '')), (c) => c.charCodeAt(0))
	return new TextDecoder().decode(bytes)
}

// Only a missing list fails the whole config. A bad button gets a `problem`,
// which renders it disabled with the reason, and leaves the others working.
function parseConfig(json) {
	if (!json || !Array.isArray(json.buttons)) throw new Error('expected a "buttons" list')
	for (const button of json.buttons) {
		if (typeof button.label !== 'string') {
			button.problem = 'Needs a "label".'
			button.label = typeof button.workflow === 'string' ? button.workflow : '(no label)'
		} else if (typeof button.workflow !== 'string') {
			button.problem = 'Needs a "workflow".'
		} else if (button.workflow.includes('/')) {
			button.problem = '"workflow" is a file name in .github/workflows, without a directory.'
		} else if (
			button.paths !== undefined &&
			!(Array.isArray(button.paths) && button.paths.every((p) => typeof p === 'string'))
		) {
			button.problem = '"paths" must be a list of strings.'
		} else if (
			button.inputs !== undefined &&
			(typeof button.inputs !== 'object' || button.inputs === null || Array.isArray(button.inputs))
		) {
			button.problem = '"inputs" must be a map of names to values.'
		}
	}
	return json
}

// Reads each workflow at the PR head and checks the button can dispatch it.
// A workflow that cannot be read for another reason is left to fail on click.
async function checkWorkflows(state) {
	const { owner, repo, pr } = state
	const buttons = state.config.buttons.filter((button) => !button.problem)
	const workflows = await Promise.all(
		[...new Set(buttons.map((button) => button.workflow))].map(async (workflow) => {
			const response = await api(
				'GET',
				`/repos/${owner}/${repo}/contents/.github/workflows/${encodeURIComponent(workflow)}?ref=${pr.head.sha}`
			)
			if (response.status === 404) return [workflow, { missing: true }]
			if (response.status !== 200) return [workflow, null]
			try {
				return [workflow, { yaml: parse(decodeContent(response.data)) }]
			} catch {
				return [workflow, { invalid: true }]
			}
		})
	)
	const byName = new Map(workflows)
	for (const button of buttons) {
		const workflow = byName.get(button.workflow)
		if (!workflow) continue
		const file = button.workflow
		if (workflow.missing) {
			button.problem = `${file} is not in .github/workflows on this branch.`
			continue
		}
		if (workflow.invalid) {
			button.problem = `${file} is not valid YAML.`
			continue
		}
		const on = workflow.yaml?.on
		const triggers = typeof on === 'string' ? [on] : Array.isArray(on) ? on : Object.keys(on ?? {})
		if (!triggers.includes('workflow_dispatch')) {
			button.problem = `${file} has no workflow_dispatch trigger.`
			continue
		}
		const declared =
			(on && typeof on === 'object' && !Array.isArray(on) && on.workflow_dispatch?.inputs) || {}
		const given = button.inputs ?? {}
		const unknown = Object.keys(given).filter((name) => !(name in declared))
		const missing = Object.entries(declared)
			.filter(([name, input]) => input?.required && input.default === undefined && !(name in given))
			.map(([name]) => name)
		if (unknown.length) {
			button.problem = `${file} has no input ${unknown.join(', ')}.`
		} else if (missing.length) {
			button.problem = `Missing required input ${missing.join(', ')}.`
		}
	}
}

// The API lists at most 3000 files, 100 per page.
async function changedFiles(state) {
	const { owner, repo, number } = state
	const files = []
	for (let page = 1; page <= 30; page++) {
		const response = await api(
			'GET',
			`/repos/${owner}/${repo}/pulls/${number}/files?per_page=100&page=${page}`
		)
		if (response.status !== 200) return null
		for (const file of response.data) {
			files.push(file.filename)
			if (file.previous_filename) files.push(file.previous_filename)
		}
		if (response.data.length < 100) break
	}
	return files
}

// Same rules as a workflow's `on.pull_request.paths`: the last pattern that
// matches a file decides, and a `!` pattern excludes it.
function matchesPaths(file, patterns) {
	let included = false
	for (const pattern of patterns) {
		const negated = pattern.startsWith('!')
		if (globToRegExp(negated ? pattern.slice(1) : pattern).test(file)) included = !negated
	}
	return included
}

function globToRegExp(glob) {
	let source = ''
	for (let i = 0; i < glob.length; i++) {
		const c = glob[i]
		if (c === '*' && glob[i + 1] === '*') {
			if (glob[i + 2] === '/') {
				source += '(?:.*/)?'
				i += 2
			} else {
				source += '.*'
				i += 1
			}
		} else if (c === '*') source += '[^/]*'
		else if (c === '?') source += '[^/]'
		else source += c.replace(/[.+^${}()|[\]\\]/g, '\\$&')
	}
	return new RegExp(`^${source}$`)
}

function update(patch) {
	Object.assign(current, patch)
	if (!document.getElementById(ITEM_ID)) ensure()
	else render()
}

// The spinner stays until the page navigates to the new run. A 204 is the
// older API, which returns no run, so it goes to the workflow's runs instead.
async function dispatch(state, button, index) {
	const { owner, repo, pr } = state
	const workflow = encodeURIComponent(button.workflow)
	delete state.errors[index]
	state.pending.add(index)
	render()
	const response = await api(
		'POST',
		`/repos/${owner}/${repo}/actions/workflows/${workflow}/dispatches`,
		{ ref: pr.head.ref, inputs: button.inputs ?? {} }
	)
	if (state !== current) return
	if (response.status === 200 && response.data?.html_url) {
		location.assign(response.data.html_url)
		return
	}
	if (response.status === 204) {
		const query = encodeURIComponent(`branch:${pr.head.ref} event:workflow_dispatch`)
		location.assign(`/${owner}/${repo}/actions/workflows/${workflow}?query=${query}`)
		return
	}
	state.pending.delete(index)
	state.errors[index] =
		response.data?.message ?? response.error ?? `Dispatch failed (${response.status}).`
	render()
}

// Cancel a queued or running run; re-run a failed run's failed jobs, or all
// of a cancelled run's jobs. Same endpoints as the buttons on the run's page.
const RUN_ACTIONS = {
	cancel: { path: 'cancel', label: 'Cancel', icon: X },
	'rerun-failed': { path: 'rerun-failed-jobs', label: 'Re-run failed jobs', icon: SYNC },
	rerun: { path: 'rerun', label: 'Re-run all jobs', icon: SYNC },
}

function runAction(run) {
	if (run.status !== 'completed') return 'cancel'
	if (['failure', 'timed_out', 'startup_failure'].includes(run.conclusion)) return 'rerun-failed'
	if (run.conclusion === 'cancelled') return 'rerun'
	return null
}

async function actOnRun(state, runId, action) {
	const { owner, repo } = state
	state.runsError = null
	state.runsPending.add(runId)
	render()
	const response = await api(
		'POST',
		`/repos/${owner}/${repo}/actions/runs/${runId}/${RUN_ACTIONS[action].path}`
	)
	if (state !== current) return
	state.runsPending.delete(runId)
	if (response.status >= 300) {
		state.runsError =
			response.data?.message ??
			response.error ??
			`${RUN_ACTIONS[action].label} failed (${response.status}).`
	}
	refreshRuns(state)
}

function onClick(event) {
	const runTarget = event.target.closest('[data-pr-run-action]')
	if (runTarget && current) {
		actOnRun(current, Number(runTarget.dataset.runId), runTarget.dataset.prRunAction)
		return
	}
	const target = event.target.closest('[data-pr-button]')
	if (!target || !current) return
	if (target.dataset.prButton === 'setup') {
		chrome.runtime.sendMessage({ type: 'openOptions' })
		return
	}
	const index = Number(target.dataset.prButton)
	const button = current.config.buttons[index]
	if (button) dispatch(current, button, index)
}

function render() {
	const item = document.getElementById(ITEM_ID)
	if (!item || !current) return
	if (current.phase === 'hidden') {
		item.remove()
		return
	}
	const heading = '<h3 class="discussion-sidebar-heading text-bold">Workflows</h3>'

	if (current.phase === 'setup') {
		item.innerHTML = `${heading}<button type="button" class="btn-link Link--muted f6" data-pr-button="setup">Set a GitHub token for PR buttons</button>`
		return
	}
	if (current.phase === 'error') {
		item.innerHTML = `${heading}<span class="f6 color-fg-danger">${escape(current.message)}</span>`
		return
	}

	const fork = current.pr.head.repo?.full_name !== current.pr.base.repo.full_name
	const row = (button, index) => {
		const pending = current.pending.has(index)
		const error = button.problem ?? current.errors[index]
		const title = button.problem
			? button.problem
			: fork
				? 'Workflows cannot be dispatched on a fork branch.'
				: (button.description ?? '')
		const disabled = pending || fork || button.problem
		return `<div class="mb-2">
			<button type="button" class="btn btn-sm btn-block" data-pr-button="${index}" ${disabled ? 'disabled' : ''} title="${escape(title)}">
				${pending ? `${SPINNER} ` : ''}${escape(button.label)}
			</button>
			${error ? `<div class="f6 color-fg-danger mt-1">${escape(error)}</div>` : ''}
		</div>`
	}
	const buttons = current.config.buttons.map((button, index) => ({ button, index }))
	const matched = buttons.filter(({ button }) => button.matched !== false)
	const unmatched = buttons.filter(({ button }) => button.matched === false)
	const open = item.querySelector('.github-pr-buttons-unmatched')?.open ?? false
	const olderOpen = item.querySelector('.github-pr-buttons-older-runs')?.open ?? false
	item.innerHTML =
		heading +
		matched.map(({ button, index }) => row(button, index)).join('') +
		(unmatched.length === 0
			? ''
			: `<details class="github-pr-buttons-unmatched" ${open ? 'open' : ''}>
				<summary class="f6 Link--muted mb-2">Other workflows</summary>
				${unmatched.map(({ button, index }) => row(button, index)).join('')}
			</details>`) +
		(current.runs.length + current.olderRuns.length === 0
			? ''
			: `<div class="mt-3">
				${current.runs.map(runRow).join('')}
				${
					current.olderRuns.length === 0
						? ''
						: `<details class="github-pr-buttons-older-runs" ${olderOpen ? 'open' : ''}>
							<summary class="f6 Link--muted mb-1">Other runs</summary>
							${current.olderRuns.map(runRow).join('')}
						</details>`
				}
			</div>`) +
		(current.runsError ? `<div class="f6 color-fg-danger">${escape(current.runsError)}</div>` : '')
}

function runRow(run) {
	const [icon, label] = runStatus(run)
	const action = runAction(run)
	const pending = current.runsPending.has(run.id)
	const control = !action
		? ''
		: `<button type="button" class="btn-octicon m-0 p-0" data-pr-run-action="${action}" data-run-id="${run.id}" ${pending ? 'disabled' : ''} title="${RUN_ACTIONS[action].label}" aria-label="${RUN_ACTIONS[action].label}">
			${pending ? SPINNER : octicon(action, '', RUN_ACTIONS[action].icon)}
		</button>`
	return `<div class="github-pr-buttons-run f6 mb-1 d-flex flex-items-center">
		<div class="flex-auto min-width-0 css-truncate css-truncate-overflow" title="${label}">
			${icon} <a class="Link--primary" href="${escape(run.html_url)}">${escape(run.name)}</a>
			<span class="color-fg-muted">· <relative-time datetime="${escape(run.created_at)}" format="micro"></relative-time></span>
			${
				run.head_sha === current.pr.head.sha
					? ''
					: `<span class="color-fg-muted">· <a class="Link--muted text-mono" href="/${current.owner}/${current.repo}/commit/${escape(run.head_sha)}">${escape(run.head_sha.slice(0, 7))}</a></span>`
			}
		</div>
		${control}
	</div>`
}

function runStatus(run) {
	if (run.status === 'in_progress')
		return [SPINNER.replace('anim-rotate', 'anim-rotate color-fg-attention'), 'In progress']
	if (run.status !== 'completed') return [octicon('dot-fill', 'color-fg-attention', DOT), 'Queued']
	switch (run.conclusion) {
		case 'success':
			return [octicon('check-circle-fill', 'color-fg-success', CHECK), 'Succeeded']
		case 'failure':
		case 'timed_out':
		case 'startup_failure':
			return [octicon('x-circle-fill', 'color-fg-danger', CROSS), 'Failed']
		case 'cancelled':
			return [octicon('x-circle-fill', 'color-fg-muted', CROSS), 'Cancelled']
		default:
			return [octicon('dot-fill', 'color-fg-muted', DOT), escape(run.conclusion ?? 'Completed')]
	}
}

function escape(text) {
	return String(text).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
}

document.addEventListener('click', onClick)

let scheduled = false
new MutationObserver(() => {
	if (scheduled) return
	scheduled = true
	setTimeout(() => {
		scheduled = false
		ensure()
	})
}).observe(document.body, { childList: true, subtree: true })
ensure()
