module github.com/serken/docker-snitch

go 1.24

require (
	github.com/docker/docker v27.5.1+incompatible
	github.com/florianl/go-nfqueue/v2 v2.0.0
	github.com/gorilla/websocket v1.5.3
	modernc.org/sqlite v1.29.6
)

require (
	go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp v0.56.0
	go.opentelemetry.io/otel v1.31.0
	go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp v1.31.0
	go.opentelemetry.io/otel/sdk v1.31.0
	go.opentelemetry.io/otel/trace v1.31.0
)
