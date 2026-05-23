import React from 'react';
import { createRoot } from 'react-dom/client';
import htm from 'htm';
import {
	ResponsiveContainer,
	LineChart,
	Line,
	XAxis,
	YAxis,
	Tooltip,
	CartesianGrid,
	Legend,
	AreaChart,
	Area,
	ComposedChart,
} from 'recharts';

const html = htm.bind(React.createElement);
const roots = new WeakMap();

function mount(element, node) {
	let root = roots.get(element);
	if (!root) {
		root = createRoot(element);
		roots.set(element, root);
	}
	root.render(node);
}

function MainLineChart({ payload }) {
	const { data, servers, dark, activeMetric } = payload;
	const unit = activeMetric === 'ping' ? ' ms' : ' Mb';

	const tooltipContent = (props) => {
		if (!props.active || !props.payload || !props.payload.length) return null;
		const unique = props.payload;
		return React.createElement(
			'div',
			{
				style: {
					background: dark ? '#171717' : '#fff',
					border: '1px solid ' + (dark ? '#262626' : '#e5e7eb'),
					borderRadius: 10,
					fontSize: 12,
					padding: '8px 12px',
				},
			},
			props.label
				? React.createElement(
						'p',
						{ style: { marginBottom: 4, color: dark ? '#a3a3a3' : '#6b7280', fontSize: 11 } },
						props.label,
					)
				: null,
			...unique.map((e) =>
				React.createElement(
					'div',
					{ key: e.dataKey, style: { color: e.color, padding: '1px 0' } },
					e.name + ': ' + (e.value != null ? Number(e.value).toFixed(1) : '\u2014') + unit,
				),
			),
		);
	};

	return html`
		<${ResponsiveContainer} width="100%" height="100%" initialDimension=${{ width: 100, height: 100 }}>
			<${ComposedChart} data=${data} margin=${{ top: 5, right: 10, left: -10, bottom: 0 }}>
				<${CartesianGrid} stroke=${dark ? '#262626' : '#f1f5f9'} strokeDasharray="3 3" vertical=${false} />
				<${XAxis}
					dataKey="label"
					stroke=${dark ? '#525252' : '#94a3b8'}
					tick=${{ fontSize: 11 }}
					tickLine=${false}
					axisLine=${false}
					minTickGap=${32}
				/>
				<${YAxis}
					domain=${[0, 'auto']}
					stroke=${dark ? '#525252' : '#94a3b8'}
					tick=${{ fontSize: 11 }}
					tickLine=${false}
					axisLine=${false}
					unit=${unit}
				/>
				<${Tooltip} content=${tooltipContent} />
				<${Legend} wrapperStyle=${{ fontSize: 11, paddingTop: 8 }} iconType="circle" formatter=${(value) => value.length > 20 ? value.slice(0, 19) + '\u2026' : value} />
				${servers.flatMap((server) => [
					html`<${Line}
						key=${server.id}
						type="monotone"
						dataKey=${server.id}
						name=${server.name}
						stroke=${server.color}
						strokeWidth=${2}
						dot=${false}
						activeDot=${{ r: 3 }}
						connectNulls=${false}
						isAnimationActive=${false}
					/>`,
				])}
			</${ComposedChart}>
		</${ResponsiveContainer}>
	`;
}

function SparklineChart({ payload }) {
	const { data, color, id } = payload;
	return html`
		<${ResponsiveContainer} width="100%" height="100%" initialDimension=${{ width: 100, height: 100 }}>
			<${AreaChart} data=${data}>
				<defs>
					<linearGradient id=${`g-${id}`} x1="0" y1="0" x2="0" y2="1">
						<stop offset="0%" stopColor=${color} stopOpacity=${0.4} />
						<stop offset="100%" stopColor=${color} stopOpacity=${0} />
					</linearGradient>
				</defs>
				<${Area}
					type="monotone"
					dataKey="download"
					stroke=${color}
					strokeWidth=${2}
					fill=${`url(#g-${id})`}
					isAnimationActive=${true}
					animationDuration=${700}
				/>
			</${AreaChart}>
		</${ResponsiveContainer}>
	`;
}

function HistoryChart({ payload }) {
	const { data, dark } = payload;
	const gridColor = dark ? '#262626' : '#f1f5f9';
	const axisColor = dark ? '#525252' : '#94a3b8';
	const tooltipStyle = {
		background: dark ? '#171717' : '#fff',
		border: `1px solid ${dark ? '#262626' : '#e5e7eb'}`,
		borderRadius: 10,
		fontSize: 12,
	};
	return html`
		<${ResponsiveContainer} width="100%" height="100%" initialDimension=${{ width: 100, height: 100 }}>
			<${ComposedChart} data=${data} margin=${{ top: 8, right: 40, left: -10, bottom: 0 }}>
				<${CartesianGrid} stroke=${gridColor} strokeDasharray="3 3" vertical=${false} />
				<${XAxis}
					dataKey="label"
					stroke=${axisColor}
					tick=${{ fontSize: 10, fill: axisColor }}
					tickLine=${false}
					axisLine=${false}
					minTickGap=${60}
				/>
				<${YAxis}
					yAxisId="mbps"
					orientation="left"
					stroke=${axisColor}
					tick=${{ fontSize: 10, fill: axisColor }}
					tickLine=${false}
					axisLine=${false}
					unit=" Mb"
					domain=${[0, 'auto']}
					width=${48}
				/>
				<${YAxis}
					yAxisId="ms"
					orientation="right"
					stroke=${axisColor}
					tick=${{ fontSize: 10, fill: axisColor }}
					tickLine=${false}
					axisLine=${false}
					unit=" ms"
					domain=${[0, 'auto']}
					width=${48}
				/>
				<${Tooltip} contentStyle=${tooltipStyle} labelStyle=${{ color: dark ? '#a3a3a3' : '#6b7280', marginBottom: 4 }} />
				<${Legend} wrapperStyle=${{ fontSize: 11, paddingTop: 8 }} iconType="circle" />
				<${Line}
					yAxisId="mbps"
					type="monotone"
					dataKey="download"
					name="Download"
					stroke="#10b981"
					strokeWidth=${2}
					dot=${false}
					activeDot=${{ r: 3 }}
					isAnimationActive=${false}
				/>
				<${Line}
					yAxisId="mbps"
					type="monotone"
					dataKey="upload"
					name="Upload"
					stroke="#3b82f6"
					strokeWidth=${2}
					dot=${false}
					activeDot=${{ r: 3 }}
					isAnimationActive=${false}
				/>
				<${Line}
					yAxisId="ms"
					type="monotone"
					dataKey="ping"
					name="Ping"
					stroke="#f59e0b"
					strokeWidth=${2}
					dot=${false}
					activeDot=${{ r: 3 }}
					isAnimationActive=${false}
				/>
			</${ComposedChart}>
		</${ResponsiveContainer}>
	`;
}

window.Velocity9Charts = {
	renderLineChart(element, payload) {
		mount(element, html`<${MainLineChart} payload=${payload} />`);
	},
	renderSparkline(element, payload) {
		mount(element, html`<${SparklineChart} payload=${payload} />`);
	},
	renderHistoryChart(element, payload) {
		mount(element, html`<${HistoryChart} payload=${payload} />`);
	},
};

window.dispatchEvent(new Event('velocity9-charts-ready'));
