import { html, render as renderTemplate } from 'lit-html'
import { parse } from 'yaml'

// Renders the buttons a repo lists in .github/pr-buttons.yml into the pull
// request sidebar, and dispatches their workflows on the PR's head branch.
// Buttons whose `paths` match none of the PR's files sit in a collapsed
// disclosure below the others.
//
// Everything goes through the signed-in github.com session: the same pages,
// JSON responses and forms the GitHub UI uses. A poll makes the same two
// requests however many runs there are.
//
// GitHub navigates with Turbo and re-renders sidebar partials live, so the item
// is re-inserted whenever it goes missing; state survives in `current`.

const CONFIG_PATH = '.github/pr-buttons.yml'
const ITEM_ID = 'github-pr-buttons-sidebar-item'
const RUNS_SHOWN = 5
const RUNS_POLL_MS = 10000
const JSON_HEADERS = {
	Accept: 'application/json',
	'X-Requested-With': 'XMLHttpRequest',
	'GitHub-Verified-Fetch': 'true',
}
const CHANGED = 'GitHub changed this page. Update the extension.'

function spinner(color = '') {
	return html`<svg class="anim-rotate ${color}" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true" style="vertical-align: text-bottom"><circle cx="8" cy="8" r="7" stroke="currentColor" stroke-opacity="0.25" stroke-width="2" vector-effect="non-scaling-stroke" fill="none"></circle><path d="M15 8a7.002 7.002 0 00-7-7" stroke="currentColor" stroke-width="2" stroke-linecap="round" vector-effect="non-scaling-stroke"></path></svg>`
}

function octicon(name, color, path) {
	return html`<svg class="octicon octicon-${name} ${color}" width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" style="vertical-align: text-bottom"><path d=${path}></path></svg>`
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

// Caches of things that never change, kept across page loads in the
// extension's storage. Each is a Map in least-recently-used order, so the
// oldest entries go when it is full. Tabs share it, and the last tab to save
// wins, which only loses cache entries.
function persistentCache(name, limit) {
	const ready = chrome.storage.local.get(name).then(
		(stored) => new Map(stored[name] ?? []),
		() => new Map()
	)
	let timer = 0
	const save = (map) => {
		clearTimeout(timer)
		timer = setTimeout(() => {
			while (map.size > limit) map.delete(map.keys().next().value)
			chrome.storage.local.set({ [name]: [...map] }).catch(() => {})
		}, 1000)
	}
	const touch = (map, key, value) => {
		map.delete(key)
		map.set(key, value)
		save(map)
	}
	return {
		async get(key) {
			const map = await ready
			if (!map.has(key)) return undefined
			const value = map.get(key)
			touch(map, key, value)
			return value
		},
		async set(key, value) {
			touch(await ready, key, value)
		},
	}
}

// Files by commit. Only a read or a 404 is kept; other failures can be
// transient.
const files = persistentCache('files', 200)
const fileReads = new Map()

async function readFile(owner, repo, sha, path) {
	const key = `${owner}/${repo}@${sha}:${path}`
	const cached = await files.get(key)
	if (cached) return cached
	if (!fileReads.has(key)) {
		fileReads.set(
			key,
			fetch(`/${owner}/${repo}/raw/${sha}/${path}`)
				.then(async (response) => ({
					status: response.status,
					text: response.ok ? await response.text() : null,
				}))
				.finally(() => fileReads.delete(key))
		)
	}
	const file = await fileReads.get(key)
	if (file.status === 200 || file.status === 404) files.set(key, file)
	return file
}

// The last state of each PR's section, shown as soon as the sidebar exists
// while the page's data loads. Runs keep no forms, so their controls wait for
// the refresh.
const snapshots = persistentCache('snapshots', 100)

function saveSnapshot(state) {
	const runs = (list) => list.map((run) => ({ ...run, cancelForm: null }))
	snapshots.set(state.key, {
		head: state.head,
		branch: state.branch,
		fork: state.fork,
		config: state.config,
		workflowNames: [...state.workflowNames],
		runs: runs(state.runs),
		olderRuns: runs(state.olderRuns),
		dispatched: state.dispatched,
	})
}

// The commit of each run seen on a head, or dispatched from here.
const runShas = persistentCache('runShas', 2000)

async function fetchPage(path) {
	const response = await fetch(path)
	if (!response.ok) throw new Error(`${path} returned ${response.status}.`)
	return new DOMParser().parseFromString(await response.text(), 'text/html')
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
			dispatched: [],
			runsPending: new Set(),
			runsError: null,
			workflowNames: new Map(),
			timer: 0,
		}
		// Turbo restores back/forward visits from a snapshot, which can carry a stale item.
		document.getElementById(ITEM_ID)?.remove()
		const state = current
		snapshots.get(state.key).then((snapshot) => {
			if (!snapshot || state !== current || state.phase !== 'loading') return
			update({ ...snapshot, workflowNames: new Map(snapshot.workflowNames), phase: 'ready' })
		})
		load(state)
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
	const response = await fetch(`/${owner}/${repo}/pull/${number}/files`, { headers: JSON_HEADERS })
	if (state !== current) return
	if (!response.ok) {
		return update({ phase: 'error', message: `Cannot read this pull request (${response.status}).` })
	}
	const route = (await response.json())?.payload?.pullRequestsChangesRoute
	if (state !== current) return
	const pr = route?.pullRequest
	if (!pr?.comparison?.headOid || !pr.headBranch || !Array.isArray(route.diffSummaries)) {
		return update({ phase: 'error', message: CHANGED })
	}
	state.head = pr.comparison.headOid
	state.branch = pr.headBranch
	state.fork = pr.headRepositoryOwnerLogin !== owner || pr.headRepositoryName !== repo

	const file = await readFile(owner, repo, state.head, CONFIG_PATH)
	if (state !== current) return
	if (file.status === 404) {
		snapshots.set(state.key, null)
		return update({ phase: 'hidden' })
	}
	if (!file.text) return update({ phase: 'error', message: `Cannot read ${CONFIG_PATH} (${file.status}).` })
	let config
	try {
		config = parseConfig(parse(file.text))
	} catch (error) {
		return update({ phase: 'error', message: `Invalid ${CONFIG_PATH}: ${error.message}` })
	}
	// The run list loads while the workflows are checked.
	const runPages = fetchRunPages(state)
	runPages.catch(() => {})
	const workflowNames = await checkWorkflows(state, config)
	if (state !== current) return
	// A rename lists only its new path.
	const files = route.diffSummaries.map((summary) => summary.path)
	for (const button of config.buttons) {
		button.matched =
			!Array.isArray(button.paths) || files.some((file) => matchesPaths(file, button.paths))
	}
	if (config.buttons.length === 0) {
		snapshots.set(state.key, null)
		return update({ phase: 'hidden' })
	}
	update({ phase: 'ready', config, workflowNames })
	refreshRuns(state, runPages)
}

// Dispatch runs never show in the PR's checks, so the section lists every
// dispatch run on the branch, whoever started it. The list rows carry no
// commit, so the head commit's checks page says which runs are on the head.
function fetchRunPages(state) {
	const { owner, repo } = state
	const query = encodeURIComponent(`branch:${state.branch} event:workflow_dispatch`)
	return Promise.all([
		fetchPage(`/${owner}/${repo}/actions?query=${query}`),
		fetchPage(`/${owner}/${repo}/commit/${state.head}/checks`),
	])
}

async function refreshRuns(state, pages = fetchRunPages(state)) {
	clearTimeout(state.timer)
	let list, checks
	try {
		;[list, checks] = await pages
	} catch (error) {
		if (state !== current) return
		state.runsError = `Cannot read workflow runs: ${error.message}`
		return render()
	}
	if (state !== current) return
	const names = new Set(state.workflowNames.values())
	const listed = [...list.querySelectorAll('.Box-row[id^="check_suite_"]')]
		.map(parseRunRow)
		.filter((run) => run && names.has(run.name))
	// A run this tab dispatched stays listed until the run list has it.
	state.dispatched = state.dispatched.filter((run) => !listed.some(({ id }) => id === run.id))
	const runs = [...state.dispatched, ...listed]
	for (const link of checks.querySelectorAll(
		'[id^="sidebar_check_suite_"] a[href*="/actions/runs/"]'
	)) {
		runShas.set(runId(link.getAttribute('href')), state.head)
	}
	const shas = new Map(await Promise.all(runs.map(async (run) => [run.id, await runShas.get(run.id)])))
	if (state !== current) return
	const onHead = (run) => shas.get(run.id) === state.head
	state.runsError = null
	state.runs = runs.filter(onHead).slice(0, RUNS_SHOWN)
	state.olderRuns = runs.filter((run) => !onHead(run)).slice(0, RUNS_SHOWN)
	saveSnapshot(state)
	render()
	if (
		state.dispatched.length ||
		[...state.runs, ...state.olderRuns].some((run) => run.status !== 'completed')
	) {
		state.timer = setTimeout(() => refreshRuns(state), RUNS_POLL_MS)
	}
}

function runId(href) {
	return Number(href?.match(/\/actions\/runs\/(\d+)/)?.[1]) || null
}

// One row of the Actions tab's run list. The status icon's label reads like
// "currently running: " or "completed successfully: ".
function parseRunRow(row) {
	const link = row.querySelector('a[href*="/actions/runs/"]')
	const id = runId(link?.getAttribute('href'))
	if (!id) return null
	const label = (row.querySelector('svg[aria-label]')?.getAttribute('aria-label') ?? '')
		.split(':')[0]
		.trim()
	return {
		id,
		name: link.textContent.trim(),
		html_url: link.getAttribute('href'),
		created_at: row.querySelector('relative-time')?.getAttribute('datetime') ?? '',
		label,
		...statusFromLabel(label),
		cancelForm: row.querySelector('form[action$="/cancel"]'),
	}
}

function statusFromLabel(label) {
	const text = label.toLowerCase()
	if (text.includes('running') || text.includes('in progress')) return { status: 'in_progress' }
	if (/queued|waiting|pending|requested/.test(text)) return { status: 'queued' }
	if (text.includes('success')) return { status: 'completed', conclusion: 'success' }
	if (text.includes('fail')) return { status: 'completed', conclusion: 'failure' }
	if (text.includes('timed out')) return { status: 'completed', conclusion: 'timed_out' }
	if (text.includes('cancel')) return { status: 'completed', conclusion: 'cancelled' }
	if (text.includes('skip')) return { status: 'completed', conclusion: 'skipped' }
	return { status: 'completed', conclusion: null }
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
// Returns each workflow's `name`, which defaults to its path: the run list
// names runs by it.
async function checkWorkflows(state, config) {
	const { owner, repo, head } = state
	const names = new Map()
	const buttons = config.buttons.filter((button) => !button.problem)
	const workflows = await Promise.all(
		[...new Set(buttons.map((button) => button.workflow))].map(async (workflow) => {
			const path = `.github/workflows/${workflow}`
			const file = await readFile(owner, repo, head, path)
			if (file.status === 404) return [workflow, { missing: true }]
			if (!file.text) return [workflow, null]
			try {
				const yaml = parse(file.text)
				names.set(workflow, typeof yaml?.name === 'string' ? yaml.name : path)
				return [workflow, { yaml }]
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
	return names
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

// Submits the Actions tab's "Run workflow" form, which answers with a
// redirect to the new run. The spinner stays until the page navigates there.
async function dispatch(state, button, index) {
	const { owner, repo } = state
	delete state.errors[index]
	state.pending.add(index)
	render()
	const fail = (message) => {
		if (state !== current) return
		state.pending.delete(index)
		state.errors[index] = message
		render()
	}
	try {
		const workflow = encodeURIComponent(`.github/workflows/${button.workflow}`)
		const branch = encodeURIComponent(state.branch)
		const response = await fetch(
			`/${owner}/${repo}/actions/manual?workflow=${workflow}&branch=${branch}`,
			{ headers: { 'X-Requested-With': 'XMLHttpRequest' } }
		)
		if (!response.ok) return fail(`Cannot open the run form (${response.status}).`)
		const doc = new DOMParser().parseFromString(await response.text(), 'text/html')
		// The page has a branch picker form with the same action.
		const form = [...doc.querySelectorAll('form[action$="/actions/manual"]')].find(
			(form) =>
				form.querySelector('[name="authenticity_token"]') && form.querySelector('[name="branch"]')
		)
		if (!form) return fail('You cannot run workflows in this repository.')
		const body = new FormData(form)
		for (const [name, value] of Object.entries(button.inputs ?? {})) {
			body.set(`inputs[${name}]`, String(value))
		}
		const result = await submit(form, body)
		const run = result.redirected ? runId(new URL(result.url).pathname) : null
		if (!run) return fail(`Dispatch failed (${result.status}).`)
		if (state !== current) return
		// The run is on the branch's head at dispatch time.
		runShas.set(run, state.head)
		state.dispatched.unshift({
			id: run,
			name: state.workflowNames.get(button.workflow),
			html_url: `/${owner}/${repo}/actions/runs/${run}`,
			created_at: new Date().toISOString(),
			label: 'Queued',
			status: 'queued',
			conclusion: null,
			cancelForm: null,
		})
		location.assign(`/${owner}/${repo}/actions/runs/${run}`)
	} catch (error) {
		fail(`Dispatch failed: ${error.message}`)
	}
}

// The XHR header keeps the response small: the page a form redirects to
// answers 404 to it.
function submit(form, body = new FormData(form)) {
	return fetch(form.getAttribute('action'), {
		method: 'POST',
		body,
		headers: { 'X-Requested-With': 'XMLHttpRequest' },
	})
}

// Cancel a queued or running run; re-run a failed run's failed jobs, or all
// of a cancelled run's jobs. Cancel submits the list row's form; re-run
// submits the matching form on the run's page.
const RUN_ACTIONS = {
	cancel: { label: 'Cancel', icon: X },
	'rerun-failed': { label: 'Re-run failed jobs', icon: SYNC },
	rerun: { label: 'Re-run all jobs', icon: SYNC },
}

function runAction(run) {
	if (run.status !== 'completed') return run.cancelForm ? 'cancel' : null
	if (['failure', 'timed_out'].includes(run.conclusion)) return 'rerun-failed'
	if (run.conclusion === 'cancelled') return 'rerun'
	return null
}

async function actOnRun(state, id, action) {
	const { owner, repo } = state
	const run = [...state.runs, ...state.olderRuns].find((run) => run.id === id)
	if (!run) return
	state.runsError = null
	state.runsPending.add(id)
	render()
	try {
		let form = run.cancelForm
		if (action !== 'cancel') {
			const page = await fetchPage(`/${owner}/${repo}/actions/runs/${id}`)
			const onlyFailed = action === 'rerun-failed'
			form = [...page.querySelectorAll('form[action$="/rerequest_check_suite"]')].find(
				(form) => !!form.querySelector('[name="only_failed_check_runs"]') === onlyFailed
			)
		}
		if (!form) throw new Error(CHANGED)
		const response = await submit(form)
		if (!response.ok && !response.redirected) throw new Error(`GitHub answered ${response.status}.`)
	} catch (error) {
		if (state === current) state.runsError = `${RUN_ACTIONS[action].label} failed: ${error.message}`
	}
	if (state !== current) return
	state.runsPending.delete(id)
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
	renderTemplate(section(current), item)
}

// The disclosures' `open` is not bound, so they keep what the reader chose.
function section(state) {
	const heading = html`<h3 class="discussion-sidebar-heading text-bold">Workflows</h3>`
	if (state.phase === 'error') {
		return html`${heading}<span class="f6 color-fg-danger">${state.message}</span>`
	}
	const buttons = state.config.buttons.map((button, index) => ({ button, index }))
	const matched = buttons.filter(({ button }) => button.matched !== false)
	const unmatched = buttons.filter(({ button }) => button.matched === false)
	const row = ({ button, index }) => buttonRow(state, button, index)
	return html`${heading}${matched.map(row)}
		${
			unmatched.length === 0
				? ''
				: html`<details class="github-pr-buttons-unmatched">
						<summary class="f6 Link--muted mb-2">Other workflows</summary>
						${unmatched.map(row)}
					</details>`
		}
		${
			state.runs.length + state.olderRuns.length === 0
				? ''
				: html`<div class="mt-3">
						${state.runs.map((run) => runRow(state, run))}
						${
							state.olderRuns.length === 0
								? ''
								: html`<details class="github-pr-buttons-older-runs">
										<summary class="f6 Link--muted mb-1">Other runs</summary>
										${state.olderRuns.map((run) => runRow(state, run))}
									</details>`
						}
					</div>`
		}
		${state.runsError ? html`<div class="f6 color-fg-danger">${state.runsError}</div>` : ''}`
}

function buttonRow(state, button, index) {
	const pending = state.pending.has(index)
	const error = button.problem ?? state.errors[index]
	const title =
		button.problem ??
		(state.fork ? 'Workflows cannot be dispatched on a fork branch.' : (button.description ?? ''))
	return html`<div class="mb-2">
		<button type="button" class="btn btn-sm btn-block" data-pr-button=${index} ?disabled=${pending || state.fork || !!button.problem} title=${title}>
			${pending ? html`${spinner()} ` : ''}${button.label}
		</button>
		${error ? html`<div class="f6 color-fg-danger mt-1">${error}</div>` : ''}
	</div>`
}

function runRow(state, run) {
	const [icon, label] = runStatus(run)
	const action = runAction(run)
	const pending = state.runsPending.has(run.id)
	return html`<div class="github-pr-buttons-run f6 mb-1 d-flex flex-items-center">
		<div class="flex-auto min-width-0 css-truncate css-truncate-overflow" title=${label}>
			${icon} <a class="Link--primary" href=${run.html_url}>${run.name}</a>
			<span class="color-fg-muted">· <relative-time datetime=${run.created_at} format="micro"></relative-time></span>
		</div>
		${
			action
				? html`<button type="button" class="btn-octicon m-0 p-0" data-pr-run-action=${action} data-run-id=${run.id} ?disabled=${pending} title=${RUN_ACTIONS[action].label} aria-label=${RUN_ACTIONS[action].label}>
						${pending ? spinner() : octicon(action, '', RUN_ACTIONS[action].icon)}
					</button>`
				: ''
		}
	</div>`
}

function runStatus(run) {
	if (run.status === 'in_progress') return [spinner('color-fg-attention'), 'In progress']
	if (run.status !== 'completed') return [octicon('dot-fill', 'color-fg-attention', DOT), 'Queued']
	switch (run.conclusion) {
		case 'success':
			return [octicon('check-circle-fill', 'color-fg-success', CHECK), 'Succeeded']
		case 'failure':
		case 'timed_out':
			return [octicon('x-circle-fill', 'color-fg-danger', CROSS), 'Failed']
		case 'cancelled':
			return [octicon('x-circle-fill', 'color-fg-muted', CROSS), 'Cancelled']
		default:
			return [octicon('dot-fill', 'color-fg-muted', DOT), run.label || 'Completed']
	}
}

document.addEventListener('click', onClick)

// Back from a dispatched run, the browser can restore this page as it was
// left: spinners on and the runs from before the dispatch.
addEventListener('pageshow', (event) => {
	if (!event.persisted || current?.phase !== 'ready') return
	current.pending.clear()
	refreshRuns(current)
})

let scheduled = false
new MutationObserver(() => {
	if (scheduled) return
	scheduled = true
	setTimeout(() => {
		scheduled = false
		ensure()
	})
}).observe(document.documentElement, { childList: true, subtree: true })
ensure()
