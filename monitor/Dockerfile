FROM golang:1.24-alpine AS builder

RUN apk add --no-cache gcc musl-dev

WORKDIR /app

# Copy source first, then resolve dependencies
COPY . .
RUN go mod tidy
RUN CGO_ENABLED=0 go build -o /docker-snitch ./cmd/monitor

FROM alpine:3.20

RUN apk add --no-cache iptables ip6tables

COPY --from=builder /docker-snitch /usr/local/bin/docker-snitch

ENTRYPOINT ["docker-snitch"]
