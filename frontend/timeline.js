import { Timeline, DataSet } from 'vis-timeline/standalone';
import 'vis-timeline/styles/vis-timeline-graph2d.min.css';

let timelineInstance = null;
let timelineContainer = null;

function formatDur(ms) {
	const s = Math.round(Math.abs(ms) / 1000);
	if (s < 60) return s + 's';
	if (s < 3600) return Math.floor(s / 60) + 'm ' + (s % 60) + 's';
	return Math.floor(s / 3600) + 'h ' + Math.floor((s % 3600) / 60) + 'm';
}

function buildTooltip(o) {
	const start = new Date(o.detected_at).toLocaleString();
	const end = o.restored_at ? new Date(o.restored_at).toLocaleString() : 'Ongoing';
	const dur = o.restored_at
		? formatDur(new Date(o.restored_at) - new Date(o.detected_at))
		: 'ongoing';
	return `<div class="vis-tt">
		<div class="vis-tt-title">Outage</div>
		<div>Start: <b>${start}</b></div>
		<div>End: <b>${end}</b></div>
		<div>Duration: <b>${dur}</b></div>
	</div>`;
}

function renderOutageTimeline(container, outages, { dark = false, dataFrom = null } = {}) {
	const now = new Date();
	const viewStart = new Date(now - 6 * 3600 * 1000);  
	const viewEnd = now;
	const min = dataFrom ? new Date(dataFrom) : new Date(now - 7 * 24 * 3600 * 1000);

	const items = new DataSet(
		outages.map((o) => ({
			id: o.id,
			content: '',
			title: buildTooltip(o),
			start: new Date(o.detected_at),
			end: o.restored_at ? new Date(o.restored_at) : now,
			type: 'range',
			className: 'outage-item',
		})),
	);

	const options = {
		start: viewStart,
		end: viewEnd,
		min,
		max: now,
		height: '96px',
		showCurrentTime: true,
		selectable: false,
		zoomable: true,
		moveable: true,
		stack: false,
		orientation: { axis: 'top' },
		showMajorLabels: true,
		showMinorLabels: true,
		maxHeight: '160px',
		tooltip: { followMouse: true, overflowMethod: 'cap' },
		format: {
			minorLabels: {
				minute: 'HH:mm',
				hour: 'HH:mm',
			},
		},
	};

	if (timelineInstance && timelineContainer === container) {
		timelineInstance.setItems(items);
		timelineInstance.setOptions({ min, max: now });
		timelineInstance.setWindow(viewStart, viewEnd, { animation: false });
		timelineInstance.redraw();
	} else {
		if (timelineInstance) {
			timelineInstance.destroy();
		}
		timelineInstance = new Timeline(container, items, options);
		timelineContainer = container;
	}
}

window.Velocity9Timeline = { renderOutageTimeline };
window.dispatchEvent(new Event('velocity9-timeline-ready'));
