# SVG Chart Renderer

`slide-chart-utils.ts` renders chart data as SVG using the supplied theme.
`slide-image-types.ts` defines the chart data and theme interfaces.
The `ai-svg.ts` adapter normalizes AI responses before rendering.

Keep the renderer and its data interfaces consistent when changing chart types.
Verify chart previews and native SVG insertion after functional changes.

KPI responses and mixed-unit bar-chart fallbacks render as ordinary tables.
The plugin does not offer numeric poster layouts.
