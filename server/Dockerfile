# syntax=docker/dockerfile:1
FROM --platform=$BUILDPLATFORM golang:1.26-alpine AS build
ARG TARGETOS
ARG TARGETARCH
ARG TARGETVARIANT
WORKDIR /src
COPY go.mod catalog.go main.go metadata.go cover.go ./
RUN --mount=type=cache,target=/root/.cache/go-build set -eu; \
    if [ "$TARGETARCH" = arm ]; then variant="${TARGETVARIANT:-v7}"; export GOARM="${variant#v}"; fi; \
    CGO_ENABLED=0 GOOS="$TARGETOS" GOARCH="$TARGETARCH" go build -p 2 -trimpath -o /out/obsidian-library .

FROM alpine:3.23
RUN apk add --no-cache poppler-utils font-dejavu
COPY --from=build /out/obsidian-library /obsidian-library
USER 10001:10001
ENTRYPOINT ["/obsidian-library"]
