package srv

import (
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"html/template"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"

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
	ID            string         `json:"id"`
	StoryPrompt   string         `json:"storyPrompt"`
	Characters    []Character    `json:"characters"`
	CharacterArt  []CharacterArt `json:"characterArt"`
	Keyframes     []Keyframe     `json:"keyframes"`
	Scenes        []Scene        `json:"scenes"`
	ImageProvider string         `json:"imageProvider"`
}

type Character struct {
	Index       int    `json:"index"`
	Description string `json:"description"`
}

type CharacterArt struct {
	Index    int    `json:"index"`
	ImageURL string `json:"imageUrl"`
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
		StoryPrompt   string         `json:"storyPrompt"`
		Characters    []Character    `json:"characters"`
		CharacterArt  []CharacterArt `json:"characterArt"`
		Keyframes     []Keyframe     `json:"keyframes"`
		ImageProvider string         `json:"imageProvider"`
	}
	
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}
	
	// Generate a simple project ID
	projectID := fmt.Sprintf("proj_%d", len(s.projects)+1)
	
	// Generate scenes using keyframes, characters, and character art for consistency
	scenes := generateScenesWithCharacters(req.Keyframes, req.StoryPrompt, req.Characters, req.CharacterArt)
	
	project := &Project{
		ID:            projectID,
		StoryPrompt:   req.StoryPrompt,
		Characters:    req.Characters,
		CharacterArt:  req.CharacterArt,
		Keyframes:     req.Keyframes,
		Scenes:        scenes,
		ImageProvider: req.ImageProvider,
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

// Video clip generation types
type VideoClipRequest struct {
	ProjectID string       `json:"projectId"`
	Scenes    []SceneInput `json:"scenes"`
}

type SceneInput struct {
	ID         string  `json:"id"`
	Index      int     `json:"index"`
	StartFrame string  `json:"startFrame"`
	EndFrame   *string `json:"endFrame"`
	Narration  string  `json:"narration"`
	Prompt     string  `json:"prompt"`
}

type VideoClip struct {
	SceneIndex  int    `json:"sceneIndex"`
	VideoURL    string `json:"videoUrl"`
	PosterURL   string `json:"posterUrl"`
	Duration    string `json:"duration"`
	HasEndFrame bool   `json:"hasEndFrame"`
}

func (s *Server) HandleGenerateVideoClips(w http.ResponseWriter, r *http.Request) {
	var req VideoClipRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}

	clips := make([]VideoClip, len(req.Scenes))
	
	for i, scene := range req.Scenes {
		// TODO: Integrate Veo 3 API
		// 
		// Veo 3 integration would:
		// 1. Upload start frame (and end frame if provided)
		// 2. Send prompt for video generation
		// 3. Poll for completion
		// 4. Return video URL
		//
		// API call would include:
		// - scene.StartFrame (image URL or base64)
		// - scene.EndFrame (optional, for transitions)
		// - scene.Prompt (text description for video)
		// - scene.Narration (for context)
		
		hasEndFrame := scene.EndFrame != nil && *scene.EndFrame != ""
		
		clips[i] = VideoClip{
			SceneIndex:  scene.Index,
			VideoURL:    generatePlaceholderVideo(scene.Index),
			PosterURL:   scene.StartFrame,
			Duration:    "~5s",
			HasEndFrame: hasEndFrame,
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"clips":   clips,
		"message": "Video clips generated (placeholder - Veo 3 integration pending)",
	})
}

func generatePlaceholderVideo(sceneIndex int) string {
	// Return a placeholder video URL
	// In production, this would be the actual Veo 3 generated video
	// Using a sample video for demo purposes
	return fmt.Sprintf("https://storage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4#scene=%d", sceneIndex)
}

// Save project types
type SaveProjectRequest struct {
	ProjectPath   string `json:"projectPath"`
	StoryPrompt   string `json:"storyPrompt"`
	Characters    []struct {
		Index       int    `json:"index"`
		Description string `json:"description"`
	} `json:"characters"`
	CharacterArt []struct {
		Index    int    `json:"index"`
		ImageURL string `json:"imageUrl"`
		IsLocal  bool   `json:"isLocal"`
	} `json:"characterArt"`
	Keyframes []struct {
		Index       int    `json:"index"`
		Description string `json:"description"`
	} `json:"keyframes"`
	ShotSequence  string `json:"shotSequence"`
	ImageProvider string `json:"imageProvider"`
	SavedAt       string `json:"savedAt"`
}

func (s *Server) HandleSaveProject(w http.ResponseWriter, r *http.Request) {
	var req SaveProjectRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}

	// Use provided project path or default
	basePath := req.ProjectPath
	if basePath == "" {
		basePath = "projects"
	}

	// Generate project ID
	projectID := fmt.Sprintf("proj_%d", time.Now().Unix())
	
	// Create project directory
	projectDir := filepath.Join(basePath, projectID)
	imagesDir := filepath.Join(projectDir, "images")
	
	if err := os.MkdirAll(imagesDir, 0755); err != nil {
		http.Error(w, "Failed to create project directory: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Save character art images
	savedImages := []struct {
		Index    int    `json:"index"`
		Filename string `json:"filename"`
		Path     string `json:"path"`
	}{}

	for _, art := range req.CharacterArt {
		if art.ImageURL == "" {
			continue
		}

		filename := fmt.Sprintf("character_%d.png", art.Index)
		filepath := filepath.Join(imagesDir, filename)

		// Handle base64 data URLs
		if strings.HasPrefix(art.ImageURL, "data:image") {
			if err := saveBase64Image(art.ImageURL, filepath); err != nil {
				slog.Warn("failed to save image", "error", err, "index", art.Index)
				continue
			}
		} else {
			// For URLs, just save the reference (or download in production)
			// For now, skip non-base64 images
			continue
		}

		savedImages = append(savedImages, struct {
			Index    int    `json:"index"`
			Filename string `json:"filename"`
			Path     string `json:"path"`
		}{
			Index:    art.Index,
			Filename: filename,
			Path:     filepath,
		})
	}

	// Create project JSON
	project := map[string]any{
		"id":            projectID,
		"storyPrompt":   req.StoryPrompt,
		"characters":    req.Characters,
		"characterArt":  req.CharacterArt,
		"keyframes":     req.Keyframes,
		"shotSequence":  req.ShotSequence,
		"imageProvider": req.ImageProvider,
		"savedAt":       req.SavedAt,
		"savedImages":   savedImages,
	}

	// Save JSON file
	jsonPath := filepath.Join(projectDir, "project.json")
	jsonData, err := json.MarshalIndent(project, "", "  ")
	if err != nil {
		http.Error(w, "Failed to create project JSON", http.StatusInternalServerError)
		return
	}

	if err := os.WriteFile(jsonPath, jsonData, 0644); err != nil {
		http.Error(w, "Failed to save project file", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"projectId":   projectID,
		"projectDir":  projectDir,
		"imagePath":   imagesDir,
		"jsonPath":    jsonPath,
		"savedImages": savedImages,
	})
}

// Load project from disk
func (s *Server) HandleLoadProject(w http.ResponseWriter, r *http.Request) {
	basePath := r.URL.Query().Get("path")
	projectID := r.URL.Query().Get("id")
	
	if basePath == "" || projectID == "" {
		http.Error(w, "Missing path or id parameter", http.StatusBadRequest)
		return
	}
	
	projectDir := filepath.Join(basePath, projectID)
	jsonPath := filepath.Join(projectDir, "project.json")
	
	// Read project JSON
	jsonData, err := os.ReadFile(jsonPath)
	if err != nil {
		http.Error(w, "Project not found: "+err.Error(), http.StatusNotFound)
		return
	}
	
	var project map[string]any
	if err := json.Unmarshal(jsonData, &project); err != nil {
		http.Error(w, "Invalid project file: "+err.Error(), http.StatusInternalServerError)
		return
	}
	
	// Load images from disk and convert to base64
	imagesDir := filepath.Join(projectDir, "images")
	if characterArt, ok := project["characterArt"].([]any); ok {
		for i, art := range characterArt {
			if artMap, ok := art.(map[string]any); ok {
				index := int(artMap["index"].(float64))
				imgPath := filepath.Join(imagesDir, fmt.Sprintf("character_%d.png", index))
				
				if imgData, err := os.ReadFile(imgPath); err == nil {
					base64Data := base64.StdEncoding.EncodeToString(imgData)
					artMap["imageUrl"] = "data:image/png;base64," + base64Data
					characterArt[i] = artMap
				}
			}
		}
		project["characterArt"] = characterArt
	}
	
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(project)
}

func saveBase64Image(dataURL, filepath string) error {
	// Parse data URL: data:image/png;base64,xxxxx
	parts := strings.SplitN(dataURL, ",", 2)
	if len(parts) != 2 {
		return fmt.Errorf("invalid data URL format")
	}

	// Decode base64
	imageData, err := base64.StdEncoding.DecodeString(parts[1])
	if err != nil {
		return fmt.Errorf("failed to decode base64: %w", err)
	}

	// Write to file
	if err := os.WriteFile(filepath, imageData, 0644); err != nil {
		return fmt.Errorf("failed to write file: %w", err)
	}

	return nil
}

func generateScenesWithCharacters(keyframes []Keyframe, storyPrompt string, characters []Character, characterArt []CharacterArt) []Scene {
	colors := []string{"1a1a2e", "16213e", "0f3460", "533483", "e94560", "2d4059", "3d5a80", "5c4d7d"}
	
	// Build character art lookup map
	artMap := make(map[int]string)
	for _, art := range characterArt {
		artMap[art.Index] = art.ImageURL
	}
	
	// Build character description lookup
	charMap := make(map[int]string)
	for _, char := range characters {
		charMap[char.Index] = char.Description
	}
	
	// If keyframes provided, use them
	if len(keyframes) > 0 {
		scenes := make([]Scene, len(keyframes))
		for i, kf := range keyframes {
			colorIdx := i % len(colors)
			
			// Build image prompt that includes character references
			imagePrompt := buildScenePrompt(kf.Description, characters, characterArt)
			
			// TODO: In production, this would call the image generation API
			// with the character art images as reference for consistency
			// For now, use placeholder
			scenes[i] = Scene{
				ID:          fmt.Sprintf("scene_%d", i+1),
				Narration:   kf.Description,
				ImagePrompt: imagePrompt,
				ImageURL:    fmt.Sprintf("https://placehold.co/512x288/%s/ffffff?text=Scene+%d", colors[colorIdx], i+1),
			}
		}
		return scenes
	}
	
	// Default scenes if no keyframes - generate based on story
	defaultScenes := []struct {
		narration string
		prompt    string
	}{
		{"Opening scene: " + truncate(storyPrompt, 80), "Establishing shot, cinematic opening"},
		{"The characters are introduced.", "Character introduction scene"},
		{"The story develops and tension builds.", "Rising action, dramatic lighting"},
		{"The climax of our story unfolds.", "Climactic moment, intense emotion"},
		{"Resolution and conclusion.", "Final scene, resolution"},
	}
	
	scenes := make([]Scene, len(defaultScenes))
	for i, ds := range defaultScenes {
		colorIdx := i % len(colors)
		imagePrompt := buildScenePrompt(ds.prompt, characters, characterArt)
		scenes[i] = Scene{
			ID:          fmt.Sprintf("scene_%d", i+1),
			Narration:   ds.narration,
			ImagePrompt: imagePrompt,
			ImageURL:    fmt.Sprintf("https://placehold.co/512x288/%s/ffffff?text=Scene+%d", colors[colorIdx], i+1),
		}
	}
	return scenes
}

// buildScenePrompt creates a detailed prompt that references character art for consistency
func buildScenePrompt(sceneDescription string, characters []Character, characterArt []CharacterArt) string {
	prompt := sceneDescription
	
	if len(characters) > 0 {
		prompt += "\n\nCharacters in scene (use reference images for consistency):"
		for _, char := range characters {
			prompt += fmt.Sprintf("\n- %s", char.Description)
		}
	}
	
	if len(characterArt) > 0 {
		prompt += fmt.Sprintf("\n\n[%d character reference image(s) provided for visual consistency]", len(characterArt))
	}
	
	return prompt
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
	mux.HandleFunc("POST /api/generate-video-clips", s.HandleGenerateVideoClips)
	mux.HandleFunc("POST /api/save-project", s.HandleSaveProject)
	mux.HandleFunc("GET /api/load-project", s.HandleLoadProject)
	
	// Static files
	mux.Handle("/static/", http.StripPrefix("/static/", http.FileServer(http.Dir(s.StaticDir))))
	
	slog.Info("starting server", "addr", addr)
	return http.ListenAndServe(addr, mux)
}
