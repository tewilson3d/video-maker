package srv

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"html/template"
	"log/slog"
	"net/http"
	"path/filepath"
	"runtime"
	"sync"

	"srv.exe.dev/db"
)

type Server struct {
	DB           *sql.DB
	Hostname     string
	TemplatesDir string
	StaticDir    string

	// In-memory store for projects (for now)
	mu       sync.RWMutex
	projects map[string]*Project
}

type Project struct {
	ID          string      `json:"id"`
	StoryPrompt string      `json:"storyPrompt"`
	ImageStyle  string      `json:"imageStyle"`
	Characters  []Character `json:"characters"`
	Keyframes   []Keyframe  `json:"keyframes"`
	Scenes      []Scene     `json:"scenes"`
}

type Character struct {
	Description string `json:"description"`
}

type Keyframe struct {
	Description string `json:"description"`
}

type Scene struct {
	ID          string `json:"id"`
	Narration   string `json:"narration"`
	ImagePrompt string `json:"imagePrompt"`
	ImageURL    string `json:"imageUrl"`
}

func New(dbPath, hostname string) (*Server, error) {
	_, thisFile, _, _ := runtime.Caller(0)
	baseDir := filepath.Dir(thisFile)
	srv := &Server{
		Hostname:     hostname,
		TemplatesDir: filepath.Join(baseDir, "templates"),
		StaticDir:    filepath.Join(baseDir, "static"),
		projects:     make(map[string]*Project),
	}
	if err := srv.setUpDatabase(dbPath); err != nil {
		return nil, err
	}
	return srv, nil
}

func (s *Server) HandleHome(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	if err := s.renderTemplate(w, "home.html", nil); err != nil {
		slog.Warn("render template", "url", r.URL.Path, "error", err)
	}
}

func (s *Server) HandleStoryboard(w http.ResponseWriter, r *http.Request) {
	projectID := r.PathValue("id")
	
	s.mu.RLock()
	project, exists := s.projects[projectID]
	s.mu.RUnlock()
	
	if !exists {
		http.Error(w, "Project not found", http.StatusNotFound)
		return
	}
	
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	if err := s.renderTemplate(w, "storyboard.html", project); err != nil {
		slog.Warn("render template", "url", r.URL.Path, "error", err)
	}
}

func (s *Server) HandleCreateProject(w http.ResponseWriter, r *http.Request) {
	var req struct {
		StoryPrompt string      `json:"storyPrompt"`
		ImageStyle  string      `json:"imageStyle"`
		Characters  []Character `json:"characters"`
		Keyframes   []Keyframe  `json:"keyframes"`
	}
	
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}
	
	// Generate a simple project ID
	projectID := fmt.Sprintf("proj_%d", len(s.projects)+1)
	
	// For now, create mock scenes based on keyframes or generate defaults
	// Later this will call AI APIs
	scenes := generateScenesFromKeyframes(req.Keyframes, req.StoryPrompt)
	
	project := &Project{
		ID:          projectID,
		StoryPrompt: req.StoryPrompt,
		ImageStyle:  req.ImageStyle,
		Characters:  req.Characters,
		Keyframes:   req.Keyframes,
		Scenes:      scenes,
	}
	
	s.mu.Lock()
	s.projects[projectID] = project
	s.mu.Unlock()
	
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{
		"projectId": projectID,
		"redirect":  "/storyboard/" + projectID,
	})
}

func (s *Server) HandleGetProject(w http.ResponseWriter, r *http.Request) {
	projectID := r.PathValue("id")
	
	s.mu.RLock()
	project, exists := s.projects[projectID]
	s.mu.RUnlock()
	
	if !exists {
		http.Error(w, "Project not found", http.StatusNotFound)
		return
	}
	
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(project)
}

type CharacterArtRequest struct {
	Characters []struct {
		Index       int    `json:"index"`
		Description string `json:"description"`
	} `json:"characters"`
	Provider string `json:"provider"`
}

type CharacterArtResult struct {
	Index    int    `json:"index"`
	ImageURL string `json:"imageUrl"`
	Prompt   string `json:"prompt"`
}

func (s *Server) HandleGenerateCharacterArt(w http.ResponseWriter, r *http.Request) {
	var req CharacterArtRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}

	// Generate art for each character
	// For now, use placeholder images - will integrate real providers later
	results := make([]CharacterArtResult, len(req.Characters))
	colors := []string{"6366f1", "8b5cf6", "ec4899", "f43f5e", "f97316", "eab308", "22c55e", "14b8a6"}
	
	for i, char := range req.Characters {
		colorIdx := (char.Index - 1) % len(colors)
		// In production, this would call the actual image generation API
		imageURL := generateCharacterImage(char.Description, req.Provider, colors[colorIdx])
		results[i] = CharacterArtResult{
			Index:    char.Index,
			ImageURL: imageURL,
			Prompt:   char.Description,
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"results":  results,
		"provider": req.Provider,
	})
}

func generateCharacterImage(prompt, provider, color string) string {
	// TODO: Integrate actual image generation APIs
	// For now, return placeholder
	// 
	// Provider integration points:
	// - nanobananopro: Call Nano Banana Pro API
	// - midjourney: Call Midjourney API (via Discord or third-party)
	// - dalle: Call OpenAI DALL-E 3 API
	// - stability: Call Stability AI API
	// - leonardo: Call Leonardo AI API
	
	// Placeholder with character number extracted from context
	return fmt.Sprintf("https://placehold.co/512x512/%s/ffffff?text=Character+Art", color)
}

func generateScenesFromKeyframes(keyframes []Keyframe, storyPrompt string) []Scene {
	colors := []string{"1a1a2e", "16213e", "0f3460", "533483", "e94560", "2d4059", "3d5a80", "5c4d7d"}
	
	// If keyframes provided, use them
	if len(keyframes) > 0 {
		scenes := make([]Scene, len(keyframes))
		for i, kf := range keyframes {
			colorIdx := i % len(colors)
			scenes[i] = Scene{
				ID:          fmt.Sprintf("scene_%d", i+1),
				Narration:   kf.Description,
				ImagePrompt: kf.Description,
				ImageURL:    fmt.Sprintf("https://placehold.co/512x512/%s/ffffff?text=Scene+%d", colors[colorIdx], i+1),
			}
		}
		return scenes
	}
	
	// Default scenes if no keyframes
	return []Scene{
		{
			ID:          "scene_1",
			Narration:   "Opening scene: " + truncate(storyPrompt, 50) + "...",
			ImagePrompt: "A cinematic opening shot",
			ImageURL:    "https://placehold.co/512x512/1a1a2e/ffffff?text=Scene+1",
		},
		{
			ID:          "scene_2",
			Narration:   "The story develops as characters are introduced.",
			ImagePrompt: "Character introduction",
			ImageURL:    "https://placehold.co/512x512/16213e/ffffff?text=Scene+2",
		},
		{
			ID:          "scene_3",
			Narration:   "Tension builds as the conflict emerges.",
			ImagePrompt: "Rising action",
			ImageURL:    "https://placehold.co/512x512/0f3460/ffffff?text=Scene+3",
		},
		{
			ID:          "scene_4",
			Narration:   "The climax of our story unfolds.",
			ImagePrompt: "Dramatic climax",
			ImageURL:    "https://placehold.co/512x512/533483/ffffff?text=Scene+4",
		},
		{
			ID:          "scene_5",
			Narration:   "Resolution and conclusion of the narrative.",
			ImagePrompt: "Final scene",
			ImageURL:    "https://placehold.co/512x512/e94560/ffffff?text=Scene+5",
		},
	}
}

func truncate(s string, maxLen int) string {
	if len(s) <= maxLen {
		return s
	}
	return s[:maxLen]
}

func (s *Server) renderTemplate(w http.ResponseWriter, name string, data any) error {
	path := filepath.Join(s.TemplatesDir, name)
	funcs := template.FuncMap{
		"plus1": func(i int) int { return i + 1 },
	}
	tmpl, err := template.New(name).Funcs(funcs).ParseFiles(path)
	if err != nil {
		return fmt.Errorf("parse template %q: %w", name, err)
	}
	if err := tmpl.Execute(w, data); err != nil {
		return fmt.Errorf("execute template %q: %w", name, err)
	}
	return nil
}

func (s *Server) setUpDatabase(dbPath string) error {
	wdb, err := db.Open(dbPath)
	if err != nil {
		return fmt.Errorf("failed to open db: %w", err)
	}
	s.DB = wdb
	if err := db.RunMigrations(wdb); err != nil {
		return fmt.Errorf("failed to run migrations: %w", err)
	}
	return nil
}

func (s *Server) Serve(addr string) error {
	mux := http.NewServeMux()
	
	// Pages
	mux.HandleFunc("GET /{$}", s.HandleHome)
	mux.HandleFunc("GET /storyboard/{id}", s.HandleStoryboard)
	
	// API
	mux.HandleFunc("POST /api/projects", s.HandleCreateProject)
	mux.HandleFunc("GET /api/projects/{id}", s.HandleGetProject)
	mux.HandleFunc("POST /api/generate-character-art", s.HandleGenerateCharacterArt)
	
	// Static files
	mux.Handle("/static/", http.StripPrefix("/static/", http.FileServer(http.Dir(s.StaticDir))))
	
	slog.Info("starting server", "addr", addr)
	return http.ListenAndServe(addr, mux)
}
