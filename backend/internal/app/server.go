package app

import (
	"bufio"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/gorilla/websocket"
)

type Server struct {
	config     Config
	httpClient *http.Client
	upgrader   websocket.Upgrader
}

func NewServer(config Config) *Server {
	return &Server{
		config: config,
		httpClient: &http.Client{
			Timeout: 0,
		},
		upgrader: websocket.Upgrader{
			EnableCompression: false,
			CheckOrigin: func(r *http.Request) bool {
				return isOriginAllowed(r.Header.Get("Origin"), config.CORSAllowedOrigins)
			},
		},
	}
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", s.withLogging("healthz", s.handleHealthz))
	mux.HandleFunc("/api/chat", s.withLogging("chat", s.withCORS(s.handleChat)))
	mux.HandleFunc("/api/tts", s.withLogging("tts", s.withCORS(s.handleTTS)))
	mux.HandleFunc("/api/stt", s.withLogging("stt", s.withCORS(s.handleSTT)))
	mux.HandleFunc("/api/stt/ws", s.handleSTTWebSocket)
	return mux
}

func (s *Server) ListenAndServe() error {
	server := &http.Server{
		Addr:              ":" + s.config.Port,
		Handler:           s.Handler(),
		ReadHeaderTimeout: 10 * time.Second,
	}

	Logf("server listening addr=:%s", s.config.Port)
	return server.ListenAndServe()
}

func (s *Server) withLogging(route string, next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		r = ensureRequestContext(r)
		requestID := requestIDFromContext(r.Context())
		w.Header().Set("X-Request-Id", requestID)
		w.Header().Set("X-Content-Type-Options", "nosniff")

		startedAt := time.Now()
		recorder := &responseRecorder{
			ResponseWriter: w,
			statusCode:     http.StatusOK,
		}

		ContextDebugf(
			r.Context(),
			"request.started route=%s method=%s path=%s origin=%q remote=%q user_agent=%q",
			route,
			r.Method,
			r.URL.Path,
			r.Header.Get("Origin"),
			r.RemoteAddr,
			r.UserAgent(),
		)

		next(recorder, r)

		ContextLogf(
			r.Context(),
			"request.completed route=%s method=%s path=%s status=%d duration=%s bytes=%d",
			route,
			r.Method,
			r.URL.Path,
			recorder.statusCode,
			time.Since(startedAt).Round(time.Millisecond),
			recorder.bytesWritten,
		)
	}
}

func (s *Server) withCORS(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if matched, ok := matchAllowedOrigin(origin, s.config.CORSAllowedOrigins); ok {
			w.Header().Set("Access-Control-Allow-Origin", matched)
			w.Header().Set("Vary", "Origin")
			w.Header().Set("Access-Control-Allow-Credentials", "false")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		}

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}

		next(w, r)
	}
}

func (s *Server) handleHealthz(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{
		"status":  "ok",
		"stt":     strings.ToLower(s.config.STTProvider),
		"tts":     strings.ToLower(s.config.TTSProvider),
		"backend": "go",
	})
}

type responseRecorder struct {
	http.ResponseWriter
	statusCode   int
	bytesWritten int
}

func (r *responseRecorder) WriteHeader(statusCode int) {
	r.statusCode = statusCode
	r.ResponseWriter.WriteHeader(statusCode)
}

func (r *responseRecorder) Write(body []byte) (int, error) {
	if r.statusCode == 0 {
		r.statusCode = http.StatusOK
	}

	bytesWritten, err := r.ResponseWriter.Write(body)
	r.bytesWritten += bytesWritten
	return bytesWritten, err
}

func (r *responseRecorder) Flush() {
	flusher, ok := r.ResponseWriter.(http.Flusher)
	if ok {
		flusher.Flush()
	}
}

func (r *responseRecorder) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	hijacker, ok := r.ResponseWriter.(http.Hijacker)
	if !ok {
		return nil, nil, http.ErrNotSupported
	}

	return hijacker.Hijack()
}
