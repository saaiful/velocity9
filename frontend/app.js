export default function velocity9App() {
	return {
		dark: localStorage.getItem('theme') !== 'light',
		running: true,
		loading: true,
		saving: false,
		testing: false,
		testModalOpen: false,
		serverModalOpen: false,
		serverTab: 'catalog',
		serverSearchQuery: '',
		customHost: '',
		customPort: '5201',
		customName: '',
		customServerSaving: false,
		selectedTestServerId: '',
		testPhase: 'idle',
		testProgress: 0,
		testCurrentValue: 0,
		activeTestHost: '',
		testResult: {
			download: 0,
			upload: 0,
			ping: 0,
			jitter: 0,
		},
		activeMetric: 'download',
		errorMessage: '',
		noticeMessage: '',
		toasts: [],
		_toastId: 0,
		historyModalOpen: false,
		historyServer: null,
		historyRows: [],
		historyLoading: false,
		historyRange: '24h',
		historyFrom: '',
		historyTo: '',
		historyChartHost: null,
		outageTimelineHost: null,
		outageView: 'chart',
		syncConfirmOpen: false,
		syncInProgress: false,
		lastServerSync: null,
		catalogResults: [],
		catalogSearchLoading: false,
		_catalogSearchTimer: null,
		outageRange: '7',
		outageCustomFrom: '',
		outageCustomTo: '',
		outageRangeOpen: false,
		speedRangeOpen: false,
		speedRange: '1d',
		speedCustomFrom: '',
		speedCustomTo: '',
		testOutcome: '',
		testServerSearch: '',
		testServerDropdownOpen: false,
		animatedStats: { download: 0, upload: 0, ping: 0, jitter: 0 },
		bgTestHost: '',
		_userInitiatedTest: false,
		_dlSum: 0, _dlCount: 0,
		_ulSum: 0, _ulCount: 0,
		internetUp: true,
		outages: [],
		pingInterval: 5,
		pingStreamSrc: null,
		cronEnabled: true,
		cronInterval: '60',
		cronExpr: '0 */1 * * *',
		cronMode: 'simple',
		retainDays: '30',
		footerTimestamp: new Date().toLocaleString(),
		lastSampleTime: new Date().toLocaleTimeString(),
		colors: ['#10b981', '#3b82f6', '#f59e0b', '#a855f7', '#ef4444', '#06b6d4'],
		statsSnapshot: {
			totalTests: 0,
			avgDownload: 0,
			avgUpload: 0,
			avgPing: 0,
			avgJitter: 0,
			maxDownload: 0,
			maxUpload: 0,
			bestPing: 0,
		},
		allServers: [],
		eventsSource: null,
		appEventSrc: null,
		catalogRefreshTimer: null,
		lineChartHost: null,
		sparklineHosts: {},
		cronOptions: [
			{ v: '5', l: '5m' },
			{ v: '15', l: '15m' },
			{ v: '30', l: '30m' },
			{ v: '60', l: '1h' },
			{ v: '120', l: '2h' },
			{ v: '360', l: '6h' },
			{ v: '720', l: '12h' },
			{ v: '1440', l: '24h' },
		],
		servers: [],
		series: {},
		async init() {
			this.syncTheme();
			this.connectProgressStream();
			this.connectPingStream();
			this.connectEventStream();
			if (!this.catalogRefreshTimer) {
				this.catalogRefreshTimer = window.setInterval(() => {
					this.loadData(false);
				}, 30 * 60 * 1000);
			}
			window.addEventListener('velocity9-charts-ready', () => {
				this.$nextTick(() => {
					this.renderAllCharts();
					this.refreshIcons();
				});
			}, { once: true });
			window.addEventListener('velocity9-timeline-ready', () => {
				this.$nextTick(() => this.renderOutageTimeline());
			}, { once: true });
			this.$watch('dark', () => {
				this.syncTheme();
				this.$nextTick(() => {
					this.renderAllCharts();
					this.renderOutageTimeline();
					this.refreshIcons();
				});
			});
			this.$watch('activeMetric', () => {
				this.$nextTick(() => {
					this.renderAllCharts();
					this.refreshIcons();
				});
			});
			this.$watch('serverSearchQuery', (q) => this.searchCatalog(q));
			await this.loadData();
			await this.loadOutages();
			this.$nextTick(() => {
				this.renderAllCharts();
				this.refreshIcons();
			});
		},
		get enabledServers() {
			return this.servers.filter((server) => server.enabled);
		},
		get remainingServerCount() {
			return Math.max(this.allServers.length - this.servers.length, 0);
		},
		get filteredServerOptions() {
			return this.catalogResults;
		},
		async searchCatalog(query) {
			clearTimeout(this._catalogSearchTimer);
			const delay = query.trim() ? 300 : 0;
			this._catalogSearchTimer = setTimeout(async () => {
				this.catalogSearchLoading = true;
				try {
					const q = encodeURIComponent(query.trim());
					const results = await this.fetchJson(`/api/servers/search?q=${q}&limit=200`);
					this.catalogResults = Array.isArray(results) ? results : [];
				} catch (_) {
				} finally {
					this.catalogSearchLoading = false;
					this.$nextTick(() => this.refreshIcons());
				}
			}, delay);
		},
		currentTestServer() {
			const fromMonitored = this.servers.find((server) => server.id === this.selectedTestServerId || server.host === this.selectedTestServerId);
			if (fromMonitored) return fromMonitored;
			const fromCatalog = this.allServers.find((server) => server.server_id === this.selectedTestServerId);
			if (fromCatalog) return { id: fromCatalog.server_id, host: fromCatalog.server_id, name: this.buildTestServerLabel(fromCatalog) };
			const fallback = this.servers[0] || (this.allServers[0] ? { id: this.allServers[0].server_id, host: this.allServers[0].server_id, name: this.buildTestServerLabel(this.allServers[0]) } : null);
			return fallback;
		},
		get latestStats() {
			return {
				download: this.statsSnapshot.avgDownload,
				upload: this.statsSnapshot.avgUpload,
				ping: this.statsSnapshot.avgPing,
				jitter: this.statsSnapshot.avgJitter,
			};
		},
		get statCards() {
			return [
				{
					label: 'Download',
					value: this.animatedStats.download.toFixed(0),
					unit: 'Mbps',
					delta: `${this.statsSnapshot.totalTests} recorded tests`,
					deltaTone: 'text-emerald-600 dark:text-emerald-400',
					icon: 'download',
					iconColor: 'text-emerald-600 dark:text-emerald-400',
					accent: 'bg-emerald-50 dark:bg-emerald-500/10',
				},
				{
					label: 'Upload',
					value: this.animatedStats.upload.toFixed(0),
					unit: 'Mbps',
					delta: `Peak ${this.statsSnapshot.maxUpload.toFixed(0)} Mbps`,
					deltaTone: 'text-emerald-600 dark:text-emerald-400',
					icon: 'upload',
					iconColor: 'text-blue-600 dark:text-blue-400',
					accent: 'bg-blue-50 dark:bg-blue-500/10',
				},
				{
					label: 'Ping',
					value: this.animatedStats.ping.toFixed(0),
					unit: 'ms',
					delta: `Best ${this.statsSnapshot.bestPing.toFixed(2)} ms`,
					deltaTone: 'text-emerald-600 dark:text-emerald-400',
					icon: 'wifi',
					iconColor: 'text-amber-600 dark:text-amber-400',
					accent: 'bg-amber-50 dark:bg-amber-500/10',
				},
				{
					label: 'Jitter',
					value: this.animatedStats.jitter.toFixed(1),
					unit: 'ms',
					delta: this.statsSnapshot.avgJitter > 0 ? 'Computed from recent results' : 'No jitter data yet',
					deltaTone: 'text-neutral-500 dark:text-neutral-400',
					icon: 'activity',
					iconColor: 'text-violet-600 dark:text-violet-400',
					accent: 'bg-violet-50 dark:bg-violet-500/10',
				},
			];
		},
		get chartPoints() {
			return Object.values(this.series).flatMap((samples) =>
				samples.map((sample) => ({
					timestamp: sample.t,
					value: Number(sample[this.activeMetric]) || 0,
				}))
			);
		},
		get chartTimeBounds() {
			const timestamps = this.chartPoints.map((point) => point.timestamp);
			if (!timestamps.length) {
				const now = Date.now();
				return { min: now - 24 * 60 * 60 * 1000, max: now };
			}
			const min = Math.min(...timestamps);
			const max = Math.max(...timestamps);
			return min === max ? { min: min - 60 * 60 * 1000, max: max + 60 * 60 * 1000 } : { min, max };
		},
		get metricBounds() {
			const values = this.chartPoints.map((point) => point.value).filter((value) => Number.isFinite(value));
			if (!values.length) {
				return { min: 0, max: 1 };
			}
			const rawMin = Math.min(...values);
			const rawMax = Math.max(...values);
			const min = this.activeMetric === 'ping' ? Math.max(0, rawMin * 0.85) : 0;
			const max = rawMax === rawMin ? rawMax + 1 : rawMax * 1.05;
			return { min, max };
		},
		get xAxisLabels() {
			const { min, max } = this.chartTimeBounds;
			return [0, 0.2, 0.4, 0.6, 0.8, 1].map((ratio) => this.formatTime(min + ((max - min) * ratio)));
		},
		get yAxisTicks() {
			const { min, max } = this.metricBounds;
			const unit = this.activeMetric === 'ping' ? ' ms' : ' Mb';
			return [1, 0.75, 0.5, 0.25, 0].map((ratio) => ({
				label: `${Math.round(min + ((max - min) * ratio))}${unit}`,
			}));
		},
		get historyStats() {
			if (!this.historyRows.length) return null;
			const dl   = this.historyRows.map(r => Number(r.download_mbps) || 0).filter(v => v > 0);
			const ul   = this.historyRows.map(r => Number(r.upload_mbps) || 0).filter(v => v > 0);
			const ping = this.historyRows.map(r => Number(r.ping_latency) || 0).filter(v => v > 0);
			const avg = arr => arr.length ? +(arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(1) : 0;
			const min = arr => arr.length ? +Math.min(...arr).toFixed(1) : null;
			const max = arr => arr.length ? +Math.max(...arr).toFixed(1) : null;
			return {
				dlAvg: avg(dl), dlMax: max(dl), dlMin: min(dl),
				ulAvg: avg(ul), ulMax: max(ul), ulMin: min(ul),
				pingAvg: avg(ping), pingMin: min(ping), pingMax: max(ping),
			};
		},
		async fetchJson(url, options = {}) {
			const response = await fetch(url, {
				headers: {
					'Content-Type': 'application/json',
					...(options.headers || {}),
				},
				...options,
			});

			if (!response.ok) {
				let message = `${response.status} ${response.statusText}`;
				try {
					const payload = await response.json();
					message = payload.error || payload.message || message;
				} catch (_error) {
				}
				throw new Error(message);
			}

			return response.json();
		},
		formatTime(timestamp) {
			const date = new Date(timestamp);
			return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
		},
		formatChartLabel(timestamp, intervalMin) {
			const d = new Date(timestamp);
			const hhmm = d.getHours().toString().padStart(2, "0") + ":" + d.getMinutes().toString().padStart(2, "0");
			if (intervalMin >= 1440) {
				const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
				return d.getDate() + " " + months[d.getMonth()];
			}
			if (d.getHours() === 0 && d.getMinutes() === 0 && intervalMin >= 60) {
				return d.getDate() + "/" + (d.getMonth() + 1);
			}
			return hhmm;
		},
		parseSimpleCron(expression) {
			if (!expression) {
				return { mode: 'simple', interval: '60' };
			}

			const everyMinute = expression.match(/^\*\/(\d+) \* \* \* \*$/);
			if (everyMinute && this.cronOptions.some((option) => option.v === everyMinute[1])) {
				return { mode: 'simple', interval: everyMinute[1] };
			}

			const everyHour = expression.match(/^0 \*\/(\d+) \* \* \*$/);
			if (everyHour) {
				const minutes = String(Number(everyHour[1]) * 60);
				if (this.cronOptions.some((option) => option.v === minutes)) {
					return { mode: 'simple', interval: minutes };
				}
			}

			return { mode: 'advanced', interval: this.cronInterval };
		},
		normalizeStats(stats, results) {
			const jitters = results.map((row) => Number(row.ping_jitter)).filter((value) => Number.isFinite(value));
			return {
				totalTests: Number(stats.total_tests) || results.length,
				avgDownload: Number(stats.avg_download) || 0,
				avgUpload: Number(stats.avg_upload) || 0,
				avgPing: Number(stats.avg_ping) || 0,
				avgJitter: jitters.length ? (jitters.reduce((sum, value) => sum + value, 0) / jitters.length) : 0,
				maxDownload: Number(stats.max_download) || 0,
				maxUpload: Number(stats.max_upload) || 0,
				bestPing: Number(stats.best_ping) || 0,
			};
		},
		groupResultsByHost(results) {
			return results.reduce((accumulator, row) => {
				const host = row.server_id || 'unknown';
				if (!accumulator[host]) {
					accumulator[host] = [];
				}
				const timestamp = Date.parse(row.timestamp);
				accumulator[host].push({
					t: Number.isFinite(timestamp) ? timestamp : Date.now(),
					label: this.formatTime(Number.isFinite(timestamp) ? timestamp : Date.now()),
					download: Number(row.download_mbps) || 0,
					upload: Number(row.upload_mbps) || 0,
					ping: Number(row.ping_latency) || 0,
					jitter: Number(row.ping_jitter) || 0,
				});
				accumulator[host].sort((left, right) => left.t - right.t);
				return accumulator;
			}, {});
		},
		buildServerName(serverRecord, host) {
			if (!serverRecord) {
				return host;
			}
			const country = serverRecord.country;
			const sponsor = serverRecord.sponsor;
			if (country && sponsor) return `${country} (${sponsor})`;
			return country || sponsor || host;
		},
		deriveStatus(sample, inCatalog) {
			if (!sample) {
				return inCatalog ? 'online' : 'unknown';
			}
			if ((sample.ping || 0) > 150 || (sample.download || 0) < 25) {
				return 'degraded';
			}
			return 'online';
		},
		chooseEnabledHosts(hosts, enabledHosts, groupedResults) {
			const hostsWithSamples = hosts.filter((host) => (groupedResults[host] || []).length > 0);
			const preferredWithSamples = hostsWithSamples.filter((host) => enabledHosts.has(host));

			if (preferredWithSamples.length) {
				return new Set(preferredWithSamples);
			}

			if (hostsWithSamples.length) {
				return new Set(hostsWithSamples.slice(0, Math.min(hostsWithSamples.length, 4)));
			}

			if (enabledHosts.size) {
				return new Set(Array.from(enabledHosts).filter((host) => hosts.includes(host)));
			}

			return new Set(hosts.slice(0, Math.min(hosts.length, 4)));
		},
		decorateServers(hosts, allServersMap, effectiveEnabledHosts, groupedResults) {
			return hosts.map((host, index) => {
				const serverRecord = allServersMap.get(host);
				const latest = groupedResults[host]?.[groupedResults[host].length - 1] || null;
				return {
					id: host,
					host,
					name: this.buildServerName(serverRecord, host),
					location: serverRecord?.name || serverRecord?.country || '—',
					enabled: effectiveEnabledHosts.has(host),
					status: this.deriveStatus(latest, !!serverRecord),
					color: this.colors[index % this.colors.length],
				};
			});
		},
		buildSeriesMap(hosts, groupedResults) {
			return Object.fromEntries(hosts.map((host) => [host, groupedResults[host] || []]));
		},
		pickVisibleHosts(preferredServers, results, servers) {
			const preferredHosts = preferredServers.map((server) => server.host).filter(Boolean);
			return [...new Set(preferredHosts)];
		},
		speedRangeWindow() {
			const now = Date.now();
			if (this.speedRange === 'custom') {
				const from = this.speedCustomFrom ? new Date(this.speedCustomFrom).getTime() : now - 86400000;
				const to   = this.speedCustomTo   ? new Date(this.speedCustomTo).getTime()   : now;
				return { from, to, ms: to - from };
			}
			const msMap = { '6h': 6*3600000, '12h': 12*3600000, '1d': 86400000, '3d': 3*86400000, '7d': 7*86400000 };
			const ms = msMap[this.speedRange] || 86400000;
			return { from: now - ms, to: now, ms };
		},
		async loadData(showLoading = true) {
			if (showLoading) {
				this.loading = true;
			}

			try {
				const { from, to, ms } = this.speedRangeWindow();
				const limit = ms <= 86400000 ? 200 : ms <= 3 * 86400000 ? 500 : 2000;
				const dashboard = await this.fetchJson(`/api/dashboard?results_limit=${limit}&server_limit=10000&from=${from}&to=${to}`);
				const stats = dashboard.stats || {};
				const results = Array.isArray(dashboard.results) ? dashboard.results : [];
				const servers = Array.isArray(dashboard.serverCatalog) ? dashboard.serverCatalog : [];
				const monitoredServers = Array.isArray(dashboard.monitoredServers) ? dashboard.monitoredServers : [];
				const settings = dashboard.settings || {};
				const groupedResults = this.groupResultsByHost(results);
				const visibleHosts = this.pickVisibleHosts(monitoredServers, results, servers);
				const allServersMap = new Map(servers.map((server) => [server.server_id, server]));
				const enabledHosts = new Set(monitoredServers.filter((server) => server.enabled).map((server) => server.host));
				const effectiveEnabledHosts = this.chooseEnabledHosts(visibleHosts, enabledHosts, groupedResults);

				this.allServers = servers;
				this.statsSnapshot = this.normalizeStats(stats, results);
				this.runStatAnimations();
				this.series = { ...groupedResults };
				this.servers = this.decorateServers(visibleHosts, allServersMap, effectiveEnabledHosts, groupedResults).map((server, index) => {
					const monitored = monitoredServers.find((entry) => entry.host === server.host);
					return monitored
						? { ...server, enabled: Boolean(monitored.enabled), sortOrder: monitored.sort_order ?? index, name: monitored.label || server.name }
						: { ...server, sortOrder: index };
				}).sort((left, right) => (left.sortOrder ?? 0) - (right.sortOrder ?? 0));
				if (!this.selectedTestServerId) {
					const fallback = this.servers[0] || (this.allServers.length ? this.allServers[0] : null);
					this.selectedTestServerId = fallback ? (fallback.id || fallback.host) : '';
				}

				this.cronExpr = settings.cron_schedule || this.cronExpr;
				this.pingInterval = parseInt(settings.ping_interval) || 5;
				if (settings.last_server_sync) {
					this.lastServerSync = new Date(settings.last_server_sync).toLocaleString();
				}
				const parsedCron = this.parseSimpleCron(this.cronExpr);
				this.cronMode = parsedCron.mode;
				this.cronInterval = parsedCron.interval;
				this.cronEnabled = Boolean(this.cronExpr);

				this.updateTimestamps();
			} catch (error) {
				this.showToast(error.message || 'Failed to load live data', 'error');
			} finally {
				this.loading = false;
				this.$nextTick(() => {
					this.renderAllCharts();
					this.refreshIcons();
				});
			}
		},
		updateTimestamps() {
			this.footerTimestamp = new Date().toLocaleString();
			const samples = this.servers
				.map((server) => this.series[server.id]?.[this.series[server.id].length - 1]?.t)
				.filter(Boolean);
			this.lastSampleTime = samples.length ? new Date(Math.max(...samples)).toLocaleTimeString() : new Date().toLocaleTimeString();
		},
		isServerSelected(serverId) {
			return this.servers.some((server) => server.host === serverId || server.id === serverId);
		},
		openServerModal() {
			this.serverModalOpen = true;
			this.serverSearchQuery = '';
			this.serverTab = 'catalog';
			this.searchCatalog('');
			this.$nextTick(() => this.refreshIcons());
		},
		async addCustomServer() {
			const serverId = this.customHost.trim();
			const label = this.customName.trim() || null;
			if (!serverId) return;

			if (this.isServerSelected(serverId)) {
				this.showToast(`${serverId} is already in your server list`, 'error');
				return;
			}

			this.customServerSaving = true;
			const previousServers = this.servers.slice();
			const latest = this.series[serverId]?.[this.series[serverId].length - 1] || null;
			const catalogEntry = this.allServers.find((s) => s.server_id === serverId);
			this.servers = [
				...this.servers,
				{
					id: serverId,
					host: serverId,
					name: label || (catalogEntry ? this.buildServerName(catalogEntry, serverId) : serverId),
					location: catalogEntry?.name || catalogEntry?.country || 'Custom',
					enabled: true,
					status: this.deriveStatus(latest, false),
					color: this.colors[this.servers.length % this.colors.length],
				},
			];
			if (!this.series[serverId]) {
				this.series = { ...this.series, [serverId]: [] };
			}

			try {
				await this.createMonitoredServer({ host: serverId, enabled: true, label });
				await this.loadData(false);
				this.customHost = '';
				this.customName = '';
				this.showToast(`${label || serverId} added`, 'success');
			} catch (error) {
				this.servers = previousServers;
				this.showToast(error.message || 'Failed to add server', 'error');
				this.updateTimestamps();
				this.$nextTick(() => {
					this.renderAllCharts();
					this.refreshIcons();
				});
			} finally {
				this.customServerSaving = false;
			}
		},
		closeServerModal() {
			this.serverModalOpen = false;
			this.serverSearchQuery = '';
		},
		openSyncConfirm() {
			this.syncConfirmOpen = true;
		},
		closeSyncConfirm() {
			if (!this.syncInProgress) this.syncConfirmOpen = false;
		},
		async forceServerSync() {
			this.syncInProgress = true;
			try {
				const res = await this.fetchJson('/api/servers/sync?force=true', { method: 'POST' });
				this.lastServerSync = new Date().toLocaleString();
				this.syncConfirmOpen = false;
				this.showToast(`Server list updated — ${res.count.toLocaleString()} servers loaded`, 'success');
				await this.loadData(false);
			} catch (err) {
				this.showToast(err.message || 'Server list update failed', 'error');
			} finally {
				this.syncInProgress = false;
			}
		},
		registerLineChartHost(element) {
			this.lineChartHost = element;
			this.$nextTick(() => this.renderLineChart());
		},
		registerSparklineHost(serverId, element) {
			this.sparklineHosts[serverId] = element;
			this.$nextTick(() => this.renderSparkline(serverId));
		},
		chartDataBundle() {
			const hostsWithData = this.servers.filter((s) => (this.series[s.id] || []).length > 0);
			if (hostsWithData.length === 0) {
				return { data: [], servers: [], dark: this.dark, activeMetric: this.activeMetric };
			}

			const allSamples = hostsWithData
				.flatMap((server) => (this.series[server.id] || []).map((s) => ({ ...s, serverId: server.id })))
				.sort((a, b) => a.t - b.t);

			if (!allSamples.length) {
				return { data: [], servers: [], dark: this.dark, activeMetric: this.activeMetric };
			}

			const ROUND_MS = 10 * 60 * 1000;
			const rounds = [];
			let current = null;
			for (const sample of allSamples) {
				if (!current || sample.t - current.t > ROUND_MS) {
					current = { t: sample.t, samples: {} };
					rounds.push(current);
				}
				if (!current.samples[sample.serverId]) {
					current.samples[sample.serverId] = sample;
				}
			}

			const { ms: rangeMs } = this.speedRangeWindow();
			const labelIntervalMin = Math.round(rangeMs / 60000 / 24);

			const rows = rounds.map(({ t, samples }) => {
				const row = { label: this.formatChartLabel(t, labelIntervalMin) };
				hostsWithData.forEach((server) => {
					const s = samples[server.id];
					row[server.id] = s ? (Number(s[this.activeMetric]) || null) : null;
				});
				return row;
			});

			return {
				data: rows,
				servers: hostsWithData.map((server) => ({ id: server.id, name: server.name, color: server.color })),
				dark: this.dark,
				activeMetric: this.activeMetric,
			};
		},
		renderLineChart() {
			if (!this.lineChartHost || !window.Velocity9Charts?.renderLineChart) {
				return;
			}
			window.Velocity9Charts.renderLineChart(this.lineChartHost, this.chartDataBundle());
		},
		renderSparkline(serverId) {
			const element = this.sparklineHosts[serverId];
			const server = this.servers.find((entry) => entry.id === serverId);
			if (!element || !server || !window.Velocity9Charts?.renderSparkline) {
				return;
			}
			window.Velocity9Charts.renderSparkline(element, {
				id: serverId,
				color: server.color,
				data: (this.series[serverId] || []).slice(-24),
			});
		},
		renderSparklineCharts() {
			Object.keys(this.sparklineHosts).forEach((serverId) => this.renderSparkline(serverId));
		},
		renderAllCharts() {
			this.renderLineChart();
			this.renderSparklineCharts();
		},
		syncTheme() {
			document.documentElement.classList.toggle('dark', this.dark);
			localStorage.setItem('theme', this.dark ? 'dark' : 'light');
		},
		toggleDark() {
			this.dark = !this.dark;
		},
		resetTestModalState() {
			this.testPhase = 'idle';
			this.testProgress = 0;
			this.testCurrentValue = 0;
			this.activeTestHost = '';
			this.testResult = { download: 0, upload: 0, ping: 0, jitter: 0 };
		},
		runTestForServer(server) {
			if (this.testing) return;
			this.selectedTestServerId = server.id;
			this.testModalOpen = true;
			this.$nextTick(() => {
				this.refreshIcons();
				this.startSelectedTest();
			});
		},
		openTestModal() {
			if (!this.selectedTestServerId) {
				const fallback = this.servers.find((s) => s.status !== 'offline') || this.servers[0] || this.allServers[0] || null;
				this.selectedTestServerId = fallback ? (fallback.id || fallback.host) : '';
			}
			this.testModalOpen = true;
			this.$nextTick(() => this.refreshIcons());
		},
		closeTestModal() {
			this.testModalOpen = false;
			this.testServerDropdownOpen = false;
			this.testServerSearch = '';
			this.$nextTick(() => this.refreshIcons());
		},
		testPhaseLabel() {
			return {
				idle: 'Ready',
				ping: 'Measuring latency',
				download: 'Download',
				upload: 'Upload',
				done: 'Complete',
			}[this.testPhase] || 'Ready';
		},
		testDisplayUnit() {
			return this.testPhase === 'ping' ? 'ms' : 'Mbps';
		},
		testDisplayValue() {
			if (this.testPhase === 'ping') {
				return this.testResult.ping || Math.round(this.testCurrentValue);
			}
			return Math.round(this.testCurrentValue);
		},
		testGaugePath() {
			return 'M 20 140 A 120 120 0 0 1 260 140';
		},
		testGaugeDasharray() {
			const radius = 120;
			const circumference = Math.PI * radius;
			const maxScale = this.testPhase === 'ping' ? 100 : 500;
			const pct = Math.min(1, Math.max(0, this.testDisplayValue() / maxScale));
			return `${(circumference * pct).toFixed(2)} ${circumference.toFixed(2)}`;
		},
		testMetricCards() {
			return [
				{ key: 'ping', label: 'Ping', icon: 'wifi', value: this.testResult.ping ? `${this.testResult.ping} ms` : '—', color: 'text-amber-600 dark:text-amber-400' },
				{ key: 'download', label: 'Download', icon: 'download', value: this.testResult.download ? `${this.testResult.download} Mbps` : '—', color: 'text-emerald-600 dark:text-emerald-400' },
				{ key: 'upload', label: 'Upload', icon: 'upload', value: this.testResult.upload ? `${this.testResult.upload} Mbps` : '—', color: 'text-blue-600 dark:text-blue-400' },
			];
		},
		testMetricCardClass(key) {
			return this.testPhase === key
				? 'border-neutral-900 bg-neutral-50 dark:border-white dark:bg-neutral-950'
				: 'border-neutral-200 dark:border-neutral-800';
		},
		testMetricLabelClass(metric) {
			return this.testPhase === metric.key ? metric.color : 'text-neutral-500';
		},
		testMetricValueClass(key) {
			const done = (key === 'ping' && ['download', 'upload', 'done'].includes(this.testPhase))
				|| (key === 'download' && ['upload', 'done'].includes(this.testPhase))
				|| (key === 'upload' && this.testPhase === 'done');
			return done || this.testPhase === key ? 'text-neutral-900 dark:text-white' : 'text-neutral-400';
		},
		testIsRunning() {
			return this.testPhase !== 'idle' && this.testPhase !== 'done';
		},
		testActionIcon() {
			if (this.testIsRunning()) {
				return 'refresh-cw';
			}
			return this.testPhase === 'done' ? 'refresh-cw' : 'play';
		},
		testActionLabel() {
			if (this.testIsRunning()) {
				return 'Testing…';
			}
			return this.testPhase === 'done' ? 'Run again' : 'Start test';
		},
		selectCron(value) {
			this.cronInterval = value;
			this.cronExpr = Number(value) < 60 ? `*/${value} * * * *` : `0 */${Math.max(1, Number(value) / 60)} * * *`;
		},
		latestByServer(serverId) {
			const latest = this.series[serverId]?.[this.series[serverId].length - 1];
			return latest || { download: '—', upload: '—', ping: '—', jitter: '—' };
		},
		async createMonitoredServer(server) {
			return this.fetchJson('/api/monitored-servers', {
				method: 'POST',
				body: JSON.stringify({
					host: server.host,
					port: server.port || 5201,
					enabled: server.enabled,
					sort_order: this.servers.length,
					...(server.label ? { label: server.label } : {}),
				}),
			});
		},
		async updateMonitoredServer(serverId, updates) {
			return this.fetchJson(`/api/monitored-servers/${encodeURIComponent(serverId)}`, {
				method: 'PATCH',
				body: JSON.stringify(updates),
			});
		},
		async deleteMonitoredServer(serverId) {
			return this.fetchJson(`/api/monitored-servers/${encodeURIComponent(serverId)}`, {
				method: 'DELETE',
			});
		},
		async toggleServer(serverId) {
			const previousServers = this.servers.slice();
			const target = this.servers.find((server) => server.id === serverId);
			if (!target) {
				return;
			}
			this.servers = this.servers.map((server) => (
				server.id === serverId ? { ...server, enabled: !server.enabled } : server
			));
			this.errorMessage = '';
			try {
				await this.updateMonitoredServer(serverId, { enabled: !target.enabled });
				await this.loadData(false);
				this.noticeMessage = 'Test servers saved';
			} catch (error) {
				this.servers = previousServers;
				this.errorMessage = error.message || 'Failed to save test servers';
				this.updateTimestamps();
				this.$nextTick(() => {
					this.renderAllCharts();
					this.refreshIcons();
				});
			}
		},
		async removeServer(serverId) {
			const previousServers = this.servers.slice();
			const previousRunning = this.running;
			this.servers = this.servers.filter((server) => server.id !== serverId);
			if (!this.servers.length) {
				this.running = false;
			}
			delete this.sparklineHosts[serverId];
			this.errorMessage = '';
			try {
				await this.deleteMonitoredServer(serverId);
				await this.loadData(false);
				this.noticeMessage = 'Test servers saved';
			} catch (error) {
				this.servers = previousServers;
				this.running = previousRunning;
				this.errorMessage = error.message || 'Failed to save test servers';
				this.updateTimestamps();
				this.$nextTick(() => {
					this.renderAllCharts();
					this.refreshIcons();
				});
			}
		},
		async addServer(serverId = null) {
			const currentHosts = new Set(this.servers.map((server) => server.host));
			const next = serverId
				? this.allServers.find((server) => server.server_id === serverId)
				: this.allServers.find((server) => !currentHosts.has(server.server_id));
			if (!next) {
				this.noticeMessage = serverId ? 'Server was not found in the latest synced catalog' : 'All available servers are already visible';
				return;
			}

			if (currentHosts.has(next.server_id)) {
				this.noticeMessage = `${this.buildServerName(next, next.server_id)} is already selected for cron testing`;
				return;
			}

			const previousServers = this.servers.slice();
			const latest = this.series[next.server_id]?.[this.series[next.server_id].length - 1] || null;
			this.servers = [
				...this.servers,
				{
					id: next.server_id,
					host: next.server_id,
					name: this.buildServerName(next, next.server_id),
					location: next.name || next.country || '—',
					enabled: true,
					status: this.deriveStatus(latest),
					color: this.colors[this.servers.length % this.colors.length],
				},
			];
			if (!this.series[next.server_id]) {
				this.series = { ...this.series, [next.server_id]: [] };
			}
			this.errorMessage = '';
			this.serverSearchQuery = '';
			try {
				await this.createMonitoredServer({
					host: next.server_id,
					enabled: true,
				});
				await this.loadData(false);
				this.noticeMessage = 'Test servers saved';
			} catch (error) {
				this.servers = previousServers;
				this.errorMessage = error.message || 'Failed to save test servers';
				this.updateTimestamps();
				this.$nextTick(() => {
					this.renderAllCharts();
					this.refreshIcons();
				});
			}
		},
		async startSelectedTest() {
			if (this.testing) {
				return;
			}

			const target = this.currentTestServer();
			if (!target) {
				this.showToast('Select a server to run the test', 'error');
				return;
			}
			this.testOutcome = '';
			this._userInitiatedTest = true;
			this.testing = true;
			this.testModalOpen = true;
			this.testPhase = 'ping';
			this.testProgress = 0;
			this.testCurrentValue = 0;
			this.activeTestHost = target.host;
			this.testResult = { download: 0, upload: 0, ping: 0, jitter: 0 };

			try {
				await this.fetchJson('/api/test/run', {
					method: 'POST',
					body: JSON.stringify(target ? { host: target.host, port: target.port } : {}),
				});

				this.$nextTick(() => this.refreshIcons());
			} catch (error) {
				this.testing = false;
				this.testPhase = 'idle';
				this.testOutcome = 'error';
				this.showToast(error.message || 'Failed to start test', 'error');
			}
		},
		buildLinePath(samples, key, width, height) {
			if (!samples.length) {
				return '';
			}

			const { min: minTime, max: maxTime } = this.chartTimeBounds;
			const { min: minValue, max: maxValue } = this.metricBounds;
			const timeRange = maxTime - minTime || 1;
			const valueRange = maxValue - minValue || 1;

			return samples.map((sample, index) => {
				const x = ((sample.t - minTime) / timeRange) * width;
				const value = Number(sample[key]) || 0;
				const y = height - ((value - minValue) / valueRange) * height;
				return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
			}).join(' ');
		},
		mainChartPath(serverId) {
			return this.buildLinePath(this.series[serverId] || [], this.activeMetric, 960, 280);
		},
		buildSparklinePath(samples, width, height) {
			if (!samples.length) {
				return '';
			}

			const values = samples.map((sample) => Number(sample.download) || 0);
			const min = Math.min(...values);
			const max = Math.max(...values);
			const range = max - min || 1;

			return samples.map((sample, index) => {
				const x = (index / Math.max(samples.length - 1, 1)) * width;
				const y = height - (((Number(sample.download) || 0) - min) / range) * height;
				return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
			}).join(' ');
		},
		sparklinePath(serverId) {
			const samples = (this.series[serverId] || []).slice(-24);
			return this.buildSparklinePath(samples, 240, 56);
		},
		sparklineFill(serverId) {
			const samples = (this.series[serverId] || []).slice(-24);
			if (!samples.length) {
				return '';
			}

			const path = this.buildSparklinePath(samples, 240, 56);
			return `${path} L 240 64 L 0 64 Z`;
		},
		connectProgressStream() {
			if (this.eventsSource) {
				this.eventsSource.close();
			}

			this.eventsSource = new EventSource('/api/test/progress');
			this.eventsSource.onmessage = async (event) => {
				const payload = JSON.parse(event.data);
				if (payload.type === 'status') {
					this.testing = Boolean(payload.running);
					return;
				}

				if (payload.type === 'start') {
					this.testing = true;
					if (this._userInitiatedTest) {
						this.testModalOpen = true;
					} else {
						this.bgTestHost = payload.server?.host || '';
					}
					this._userInitiatedTest = false;
					this.testPhase = 'ping';
					this.testProgress = 0;
					this.testCurrentValue = 0;
					this.testResult = { download: 0, upload: 0, ping: 0, jitter: 0 };
					this._dlSum = 0; this._dlCount = 0;
					this._ulSum = 0; this._ulCount = 0;
					this.activeTestHost = payload.server?.host || this.activeTestHost;
					if (payload.server?.host) {
						const match = this.servers.find((server) => server.host === payload.server.host || server.id === payload.server.host);
						if (match) {
							this.selectedTestServerId = match.id;
						}
					}

					this.$nextTick(() => this.refreshIcons());
					return;
				}

				if (payload.type === 'ping') {
					this.testPhase = 'ping';
					this.testProgress = Math.round((payload.progress || 0) * 100);
					if (payload.latency != null) {
						this.testResult = { ...this.testResult, ping: Math.round(payload.latency), jitter: Number(payload.jitter) || this.testResult.jitter };
						this.testCurrentValue = Number(payload.latency) || this.testCurrentValue;
					} else {
						this.testCurrentValue = Math.max(1, Math.round((payload.progress || 0) * 100));
					}
					return;
				}

				if (payload.type === 'download') {
					this.testPhase = 'download';
					this.testProgress = Math.round((payload.progress || 0) * 100);
					if (payload.bandwidth_mbps != null) {
						this.testCurrentValue = Number(payload.bandwidth_mbps) || 0;
						if ((payload.progress || 0) >= 1) {
							this.testResult = { ...this.testResult, download: Math.round(Number(payload.bandwidth_mbps) || 0) };
						} else {
							this._dlSum += this.testCurrentValue;
							this._dlCount++;
							this.testResult = { ...this.testResult, download: Math.round(this._dlSum / this._dlCount) };
						}
					} else {
						this.testCurrentValue = 0;
					}
					return;
				}

				if (payload.type === 'upload') {
					this.testPhase = 'upload';
					this.testProgress = Math.round((payload.progress || 0) * 100);
					if (payload.bandwidth_mbps != null) {
						this.testCurrentValue = Number(payload.bandwidth_mbps) || 0;
						if ((payload.progress || 0) >= 1) {
							this.testResult = { ...this.testResult, upload: Math.round(Number(payload.bandwidth_mbps) || 0) };
						} else {
							this._ulSum += this.testCurrentValue;
							this._ulCount++;
							this.testResult = { ...this.testResult, upload: Math.round(this._ulSum / this._ulCount) };
						}
					} else {
						this.testCurrentValue = 0;
					}
					return;
				}

				if (payload.type === 'complete') {
					this.testing = false;
					this.testPhase = 'done';
					this.testProgress = 100;
					if (payload.result) {
						this.testResult = {
							download: Math.round(Number(payload.result.download_mbps) || 0),
							upload: Math.round(Number(payload.result.upload_mbps) || 0),
							ping: Math.round(Number(payload.result.ping_latency) || 0),
							jitter: Number(payload.result.ping_jitter) || 0,
						};
						this.testCurrentValue = Math.round(Number(payload.result.upload_mbps) || Number(payload.result.download_mbps) || 0);
					}
					this.testOutcome = 'success';
					this.bgTestHost = '';
					await this.loadData(false);
					this.$nextTick(() => this.refreshIcons());
					return;
				}

				if (payload.type === 'error') {
					this.testing = false;
					this.testPhase = 'idle';
					this.testProgress = 0;
					this.testOutcome = 'error';
					this.bgTestHost = '';
					this.showToast(payload.message || 'Test failed', 'error');
				}
			};
			this.eventsSource.onerror = () => {
				this.running = false;
			};
		},
		async saveConfiguration() {
			this.saving = true;

			try {
				await this.fetchJson('/api/settings', {
					method: 'PUT',
					body: JSON.stringify({ cron_schedule: this.cronEnabled ? this.cronExpr : '' }),
				});

				this.showToast(this.cronEnabled ? 'Schedule saved' : 'Schedule disabled', 'success');
				await this.loadData(false);
			} catch (error) {
				this.showToast(error.message || 'Failed to save configuration', 'error');
			} finally {
				this.saving = false;
			}
		},
		showToast(message, type = 'info') {
			const id = ++this._toastId;
			this.toasts.push({ id, type, message });
			this.$nextTick(() => this.refreshIcons());
			window.setTimeout(() => this.dismissToast(id), 5000);
		},
		dismissToast(id) {
			this.toasts = this.toasts.filter((t) => t.id !== id);
		},
		buildTestServerLabel(server) {
			if (server.server_id) return this.buildServerName(server, server.server_id);
			const name = server.label || server.name || server.host;
			return server.country ? `${name} · ${server.country}` : name;
		},
		filteredTestServers() {
			const catalogIds = new Set(this.allServers.map((s) => s.server_id));
			const customEntries = this.servers
				.filter((s) => !catalogIds.has(s.host))
				.map((s) => ({ server_id: s.host, host: s.host, name: s.name, label: s.name !== s.host ? s.name : null, country: s.country, cc: s.cc }));
			const combined = [...this.allServers, ...customEntries];
			const q = this.testServerSearch.toLowerCase().trim();
			if (!q) return combined.slice(0, 200);
			return combined.filter((s) => {
				const label = this.buildTestServerLabel(s).toLowerCase();
				const id = (s.server_id || s.host || '').toLowerCase();
				return label.includes(q) || id.includes(q);
			}).slice(0, 200);
		},
		animateStatValue(key, target, duration) {
			duration = duration || 700;
			const start = this.animatedStats[key] || 0;
			if (Math.abs(start - target) < 0.01) { this.animatedStats[key] = target; return; }
			const startTime = performance.now();
			const self = this;
			function step(now) {
				const progress = Math.min((now - startTime) / duration, 1);
				const eased = 1 - Math.pow(1 - progress, 3);
				self.animatedStats[key] = start + (target - start) * eased;
				if (progress < 1) requestAnimationFrame(step);
				else self.animatedStats[key] = target;
			}
			requestAnimationFrame(step);
		},
		formatDuration(ms) {
			const s = Math.round(ms / 1000);
			if (s < 60) return s + 's';
			if (s < 3600) return Math.floor(s / 60) + 'm ' + (s % 60) + 's';
			return Math.floor(s / 3600) + 'h ' + Math.floor((s % 3600) / 60) + 'm';
		},
		runStatAnimations() {
			this.animateStatValue('download', this.statsSnapshot.avgDownload);
			this.animateStatValue('upload', this.statsSnapshot.avgUpload);
			this.animateStatValue('ping', this.statsSnapshot.avgPing);
			this.animateStatValue('jitter', this.statsSnapshot.avgJitter);
		},
		connectEventStream() {
			if (this.appEventSrc) this.appEventSrc.close();
			const src = new EventSource('/api/events');
			let _reloadTimer = null;
			const scheduleReload = () => {
				clearTimeout(_reloadTimer);
				_reloadTimer = setTimeout(() => this.loadData(false), 300);
			};
			src.onmessage = (e) => {
				try {
					const d = JSON.parse(e.data);
					if (d.type === 'servers-changed') {
						scheduleReload();
					} else if (d.type === 'catalog-synced') {
						this.lastServerSync = new Date().toLocaleString();
						scheduleReload();
					} else if (d.type === 'test-complete') {
						scheduleReload();
					}
				} catch (_) {}
			};
			src.onerror = () => {
			};
			this.appEventSrc = src;
		},
		connectPingStream() {
			if (this.pingStreamSrc) this.pingStreamSrc.close();
			const src = new EventSource('/api/ping/stream');
			src.onmessage = (e) => {
				try {
					const d = JSON.parse(e.data);
					if (d.type === 'status' || d.type === 'change') {
						this.internetUp = d.up !== false && d.status !== 'down';
						if (d.type === 'change') this.loadOutages();
					}
				} catch (_) {}
			};
			this.pingStreamSrc = src;
		},
		async loadOutages() {
			try {
				const now = Date.now();
				let from, to;
				if (this.outageRange === 'custom') {
					from = this.outageCustomFrom ? new Date(this.outageCustomFrom).getTime() : now - 7 * 24 * 60 * 60 * 1000;
					to = this.outageCustomTo ? new Date(this.outageCustomTo).getTime() : now;
				} else {
					const days = parseInt(this.outageRange, 10) || 7;
					from = now - days * 24 * 60 * 60 * 1000;
					to = now;
				}
				this.outages = await this.fetchJson(`/api/ping/outages?from=${from}&to=${to}`);
				this.$nextTick(() => this.renderOutageTimeline());
			} catch (_) {}
		},
		async savePingInterval() {
			const v = Math.min(60, Math.max(1, parseInt(this.pingInterval) || 5));
			this.pingInterval = v;
			try {
				await this.fetchJson('/api/settings', { method: 'PUT', body: JSON.stringify({ ping_interval: v }) });
				this.showToast('Ping interval saved', 'success');
			} catch (err) {
				this.showToast(err.message || 'Failed to save', 'error');
			}
		},
		async openHistoryModal(server) {
			this.historyServer = server;
			this.historyRange = '24h';
			this.historyFrom = '';
			this.historyTo = '';
			this.historyRows = [];
			this.historyModalOpen = true;
			await this.loadHistory();
		},
		closeHistoryModal() {
			this.historyModalOpen = false;
			this.historyServer = null;
			this.historyRows = [];
		},
		registerHistoryChartHost(el) {
			this.historyChartHost = el;
		},
		async loadHistory() {
			if (!this.historyServer) return;
			this.historyLoading = true;
			try {
				const params = new URLSearchParams({ limit: '1000' });
				if (this.historyRange !== 'custom' && this.historyRange !== 'all') {
					const msMap = { '1h': 3600000, '6h': 21600000, '24h': 86400000, '7d': 604800000, '30d': 2592000000 };
					const from = new Date(Date.now() - (msMap[this.historyRange] || 86400000)).toISOString();
					params.set('from', from);
				} else if (this.historyRange === 'custom') {
					if (this.historyFrom) params.set('from', new Date(this.historyFrom).toISOString());
					if (this.historyTo)   params.set('to',   new Date(this.historyTo).toISOString());
				}
				const host = this.historyServer.host || this.historyServer.id;
				const data = await this.fetchJson(`/api/history/${encodeURIComponent(host)}?${params}`);
				this.historyRows = data.rows || [];
				this.$nextTick(() => { this.renderHistoryChart(); this.refreshIcons(); });
			} catch (err) {
				this.showToast(err.message || 'Failed to load history', 'error');
			} finally {
				this.historyLoading = false;
			}
		},
		renderHistoryChart() {
			if (!this.historyChartHost || !this.historyRows.length) return;
			if (!window.Velocity9Charts?.renderHistoryChart) return;
			const data = this.historyRows.map(r => ({
				label: new Date(r.timestamp).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
				download: Math.round((Number(r.download_mbps) || 0) * 10) / 10,
				upload:   Math.round((Number(r.upload_mbps)   || 0) * 10) / 10,
				ping:     Math.round((Number(r.ping_latency)  || 0) * 10) / 10,
			}));
			window.Velocity9Charts.renderHistoryChart(this.historyChartHost, { data, dark: this.dark });
		},
		registerOutageTimelineHost(el) {
			this.outageTimelineHost = el;
		},
		renderOutageTimeline() {
			if (!this.outageTimelineHost) return;
			if (!window.Velocity9Timeline?.renderOutageTimeline) return;
			const now = Date.now();
			let dataFrom;
			if (this.outageRange === 'custom') {
				dataFrom = this.outageCustomFrom ? new Date(this.outageCustomFrom).getTime() : now - 7 * 24 * 60 * 60 * 1000;
			} else {
				dataFrom = now - (parseInt(this.outageRange, 10) || 7) * 24 * 60 * 60 * 1000;
			}
			window.Velocity9Timeline.renderOutageTimeline(
				this.outageTimelineHost,
				this.outages,
				{ dark: this.dark, dataFrom },
			);
		},
		refreshIcons() {
			if (window.lucide && typeof window.lucide.createIcons === 'function') {
				window.lucide.createIcons();
			}
		},
	};
}
