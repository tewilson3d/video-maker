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

// Save individual keyframe image
type SaveKeyframeRequest struct {
	ProjectPath string `json:"projectPath"`
	SceneIndex  int    `json:"sceneIndex"`
	ImageData   string `json:"imageData"` // base64 data URL
}

func (s *Server) HandleSaveKeyframe(w http.ResponseWriter, r *http.Request) {
	var req SaveKeyframeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request: "+err.Error(), http.StatusBadRequest)
		return
	}

	if req.ProjectPath == "" {
		http.Error(w, "Project path is required", http.StatusBadRequest)
		return
	}

	if req.ImageData == "" {
		http.Error(w, "Image data is required", http.StatusBadRequest)
		return
	}

	// Create keyframes directory
	keyframesDir := filepath.Join(req.ProjectPath, "keyframes")
	if err := os.MkdirAll(keyframesDir, 0755); err != nil {
		http.Error(w, "Failed to create keyframes directory: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Save the image
	filename := fmt.Sprintf("scene_%d.png", req.SceneIndex)
	imagePath := filepath.Join(keyframesDir, filename)

	if strings.HasPrefix(req.ImageData, "data:image") {
		if err := saveBase64Image(req.ImageData, imagePath); err != nil {
			http.Error(w, "Failed to save image: "+err.Error(), http.StatusInternalServerError)
			return
		}
	} else {
		http.Error(w, "Invalid image data format (expected base64 data URL)", http.StatusBadRequest)
		return
	}

	slog.Info("saved keyframe", "path", imagePath, "scene", req.SceneIndex)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"success":   true,
		"filename":  filename,
		"path":      imagePath,
		"sceneIndex": req.SceneIndex,
	})
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
	ProjectPath   string                   `json:"projectPath"`
	StoryPrompt   string                   `json:"storyPrompt"`
	Characters    []map[string]any         `json:"characters"`
	CharacterArt  []map[string]any         `json:"characterArt"`
	Keyframes     []map[string]any         `json:"keyframes"`
	Scenes        []map[string]any         `json:"scenes"`
	ShotSequence  string                   `json:"shotSequence"`
	ImageProvider string                   `json:"imageProvider"`
	Settings      map[string]any           `json:"settings"`
	SavedAt       string                   `json:"savedAt"`
}

func (s *Server) HandleSaveProject(w http.ResponseWriter, r *http.Request) {
	var req SaveProjectRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request: "+err.Error(), http.StatusBadRequest)
		return
	}

	projectPath := req.ProjectPath
	if projectPath == "" {
		http.Error(w, "Project path is required", http.StatusBadRequest)
		return
	}

	// Create project directories
	imagesDir := filepath.Join(projectPath, "images")
	videosDir := filepath.Join(projectPath, "videos")
	
	if err := os.MkdirAll(imagesDir, 0755); err != nil {
		http.Error(w, "Failed to create images directory: "+err.Error(), http.StatusInternalServerError)
		return
	}
	if err := os.MkdirAll(videosDir, 0755); err != nil {
		http.Error(w, "Failed to create videos directory: "+err.Error(), http.StatusInternalServerError)
		return
	}

	imageCount := 0
	videoCount := 0

	// Save character art images
	for i, art := range req.CharacterArt {
		imageURL, ok := art["imageUrl"].(string)
		if !ok || imageURL == "" {
			continue
		}

		index := i + 1
		if idx, ok := art["index"].(float64); ok {
			index = int(idx)
		}

		filename := fmt.Sprintf("character_%d.png", index)
		imagePath := filepath.Join(imagesDir, filename)

		if strings.HasPrefix(imageURL, "data:image") {
			if err := saveBase64Image(imageURL, imagePath); err != nil {
				slog.Warn("failed to save character image", "error", err, "index", index)
				continue
			}
			// Update the art entry with the filename (not the data URL)
			req.CharacterArt[i]["imageFile"] = filename
			imageCount++
		}
	}

	// Save scene/keyframe images to keyframes directory
	keyframesDir := filepath.Join(projectPath, "keyframes")
	if err := os.MkdirAll(keyframesDir, 0755); err != nil {
		slog.Warn("failed to create keyframes directory", "error", err)
	}
	
	for i, scene := range req.Scenes {
		imageURL, ok := scene["imageUrl"].(string)
		if !ok || imageURL == "" {
			continue
		}

		filename := fmt.Sprintf("scene_%d.png", i+1)
		imagePath := filepath.Join(keyframesDir, filename)

		if strings.HasPrefix(imageURL, "data:image") {
			if err := saveBase64Image(imageURL, imagePath); err != nil {
				slog.Warn("failed to save scene image", "error", err, "scene", i+1)
				continue
			}
			// Update the scene entry with the filename
			req.Scenes[i]["imageFile"] = filename
			imageCount++
		}
	}

	// Build project data for JSON (without base64 data URLs)
	projectData := map[string]any{
		"storyPrompt":   req.StoryPrompt,
		"characters":    req.Characters,
		"characterArt":  cleanImageURLs(req.CharacterArt),
		"keyframes":     req.Keyframes,
		"scenes":        cleanImageURLs(req.Scenes),
		"shotSequence":  req.ShotSequence,
		"imageProvider": req.ImageProvider,
		"settings":      req.Settings,
		"savedAt":       time.Now().Format(time.RFC3339),
	}

	// Save project.json
	jsonPath := filepath.Join(projectPath, "project.json")
	jsonData, err := json.MarshalIndent(projectData, "", "  ")
	if err != nil {
		http.Error(w, "Failed to create project JSON: "+err.Error(), http.StatusInternalServerError)
		return
	}

	if err := os.WriteFile(jsonPath, jsonData, 0644); err != nil {
		http.Error(w, "Failed to save project file: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"projectPath": projectPath,
		"imageCount":  imageCount,
		"videoCount":  videoCount,
	})
}

// cleanImageURLs removes base64 data URLs from items, keeping only imageFile references
func cleanImageURLs(items []map[string]any) []map[string]any {
	result := make([]map[string]any, len(items))
	for i, item := range items {
		clean := make(map[string]any)
		for k, v := range item {
			// Skip base64 data URLs, keep everything else
			if k == "imageUrl" {
				if str, ok := v.(string); ok && strings.HasPrefix(str, "data:") {
					continue
				}
			}
			clean[k] = v
		}
		result[i] = clean
	}
	return result
}

// Load project from disk
func (s *Server) HandleLoadProject(w http.ResponseWriter, r *http.Request) {
	projectPath := r.URL.Query().Get("path")
	
	if projectPath == "" {
		http.Error(w, "Missing path parameter", http.StatusBadRequest)
		return
	}
	
	jsonPath := filepath.Join(projectPath, "project.json")
	imagesDir := filepath.Join(projectPath, "images")
	
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
	
	// Load character art images from disk and convert to base64
	if characterArt, ok := project["characterArt"].([]any); ok {
		for i, art := range characterArt {
			if artMap, ok := art.(map[string]any); ok {
				// Try to load image by imageFile first, then by index
				var imgPath string
				if imageFile, ok := artMap["imageFile"].(string); ok && imageFile != "" {
					imgPath = filepath.Join(imagesDir, imageFile)
				} else if idx, ok := artMap["index"].(float64); ok {
					imgPath = filepath.Join(imagesDir, fmt.Sprintf("character_%d.png", int(idx)))
				}
				
				if imgPath != "" {
					if imgData, err := os.ReadFile(imgPath); err == nil {
						mimeType := detectMimeType(imgPath)
						base64Data := base64.StdEncoding.EncodeToString(imgData)
						artMap["imageUrl"] = fmt.Sprintf("data:%s;base64,%s", mimeType, base64Data)
						characterArt[i] = artMap
					}
				}
			}
		}
		project["characterArt"] = characterArt
	}
	
	// Load scene/keyframe images from disk and convert to base64
	// Check keyframes directory first, fall back to images directory
	keyframesDir := filepath.Join(projectPath, "keyframes")
	if scenes, ok := project["scenes"].([]any); ok {
		for i, scene := range scenes {
			if sceneMap, ok := scene.(map[string]any); ok {
				// Try to load image by imageFile first, then by index
				var imgPath string
				filename := ""
				if imageFile, ok := sceneMap["imageFile"].(string); ok && imageFile != "" {
					filename = imageFile
				} else {
					filename = fmt.Sprintf("scene_%d.png", i+1)
				}
				
				// Try keyframes directory first
				imgPath = filepath.Join(keyframesDir, filename)
				if _, err := os.Stat(imgPath); os.IsNotExist(err) {
					// Fall back to images directory for backward compatibility
					imgPath = filepath.Join(imagesDir, filename)
				}
				
				if imgPath != "" {
					if imgData, err := os.ReadFile(imgPath); err == nil {
						mimeType := detectMimeType(imgPath)
						base64Data := base64.StdEncoding.EncodeToString(imgData)
						sceneMap["imageUrl"] = fmt.Sprintf("data:%s;base64,%s", mimeType, base64Data)
						scenes[i] = sceneMap
					}
				}
			}
		}
		project["scenes"] = scenes
	}
	
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(project)
}

// detectMimeType returns the MIME type based on file extension
func detectMimeType(path string) string {
	ext := strings.ToLower(filepath.Ext(path))
	switch ext {
	case ".png":
		return "image/png"
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".gif":
		return "image/gif"
	case ".webp":
		return "image/webp"
	default:
		return "image/png"
	}
}

// HandleBrowseFolders returns a list of folders for the file browser
func (s *Server) HandleBrowseFolders(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Query().Get("path")
	if path == "" {
		path = "/home/exedev/video-maker/projects"
	}

	// Clean and validate path
	path = filepath.Clean(path)
	
	// Check if path exists
	info, err := os.Stat(path)
	if err != nil {
		if os.IsNotExist(err) {
			// Return parent directory if path doesn't exist
			path = filepath.Dir(path)
			info, err = os.Stat(path)
			if err != nil {
				http.Error(w, "Path not found", http.StatusNotFound)
				return
			}
		} else {
			http.Error(w, "Error accessing path: "+err.Error(), http.StatusInternalServerError)
			return
		}
	}

	// If path is a file, use its directory
	if !info.IsDir() {
		path = filepath.Dir(path)
	}

	// Read directory contents
	entries, err := os.ReadDir(path)
	if err != nil {
		http.Error(w, "Error reading directory: "+err.Error(), http.StatusInternalServerError)
		return
	}

	type FolderEntry struct {
		Name    string `json:"name"`
		Path    string `json:"path"`
		IsDir   bool   `json:"isDir"`
		HasProjectJSON bool `json:"hasProjectJson"`
	}

	folders := []FolderEntry{}
	
	// Add parent directory option (unless at root)
	if path != "/" {
		parentPath := filepath.Dir(path)
		folders = append(folders, FolderEntry{
			Name:  "..",
			Path:  parentPath,
			IsDir: true,
		})
	}

	for _, entry := range entries {
		if !entry.IsDir() {
			continue // Only show directories
		}
		
		// Skip hidden directories
		if strings.HasPrefix(entry.Name(), ".") {
			continue
		}

		entryPath := filepath.Join(path, entry.Name())
		
		// Check if this folder has a project.json
		hasProjectJSON := false
		if _, err := os.Stat(filepath.Join(entryPath, "project.json")); err == nil {
			hasProjectJSON = true
		}

		folders = append(folders, FolderEntry{
			Name:           entry.Name(),
			Path:           entryPath,
			IsDir:          true,
			HasProjectJSON: hasProjectJSON,
		})
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"currentPath": path,
		"folders":     folders,
	})
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
	mux.HandleFunc("POST /api/save-keyframe", s.HandleSaveKeyframe)
	mux.HandleFunc("GET /api/load-project", s.HandleLoadProject)
	mux.HandleFunc("GET /api/browse-folders", s.HandleBrowseFolders)

	// Static files
	mux.Handle("/static/", http.StripPrefix("/static/", http.FileServer(http.Dir(s.StaticDir))))
	
	slog.Info("starting server", "addr", addr)
	return http.ListenAndServe(addr, mux)
}
