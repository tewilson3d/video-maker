package srv

import (
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"html/template"
	"io"
	"log/slog"
	"net/http"
	"os"
	"os/exec"
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
	ArtImages  []ArtImages `json:"artImages"`
	Keyframes     []Keyframe     `json:"keyframes"`
	Scenes        []Scene        `json:"scenes"`
	ImageProvider string         `json:"imageProvider"`
}

type Character struct {
	Index       int    `json:"index"`
	Description string `json:"description"`
}

type ArtImages struct {
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
		ArtImages  []ArtImages `json:"artImages"`
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
	scenes := generateScenesWithCharacters(req.Keyframes, req.StoryPrompt, req.Characters, req.ArtImages)
	
	project := &Project{
		ID:            projectID,
		StoryPrompt:   req.StoryPrompt,
		Characters:    req.Characters,
		ArtImages:  req.ArtImages,
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

type ArtImagesRequest struct {
	Characters []struct {
		Index       int    `json:"index"`
		Description string `json:"description"`
	} `json:"characters"`
	Provider string `json:"provider"`
}

type ArtImagesResult struct {
	Index    int    `json:"index"`
	ImageURL string `json:"imageUrl"`
	Prompt   string `json:"prompt"`
}

func (s *Server) HandleGenerateArtImages(w http.ResponseWriter, r *http.Request) {
	var req ArtImagesRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}

	// Generate art for each character
	// For now, use placeholder images - will integrate real providers later
	results := make([]ArtImagesResult, len(req.Characters))
	colors := []string{"6366f1", "8b5cf6", "ec4899", "f43f5e", "f97316", "eab308", "22c55e", "14b8a6"}
	
	for i, char := range req.Characters {
		colorIdx := (char.Index - 1) % len(colors)
		// In production, this would call the actual image generation API
		imageURL := generateCharacterImage(char.Description, req.Provider, colors[colorIdx])
		results[i] = ArtImagesResult{
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

// Save video clips to project
type SaveVideoClipsRequest struct {
	ProjectPath string                 `json:"projectPath"`
	Storyboard  map[string]interface{} `json:"storyboard"`
	VideoClips  []interface{}          `json:"videoClips"`
}

func (s *Server) HandleSaveVideoClips(w http.ResponseWriter, r *http.Request) {
	var req SaveVideoClipsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request: "+err.Error(), http.StatusBadRequest)
		return
	}

	if req.ProjectPath == "" {
		http.Error(w, "Project path is required", http.StatusBadRequest)
		return
	}

	// Create project directory
	if err := os.MkdirAll(req.ProjectPath, 0755); err != nil {
		http.Error(w, "Failed to create project directory: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Create videos directory
	videosDir := filepath.Join(req.ProjectPath, "videos")
	if err := os.MkdirAll(videosDir, 0755); err != nil {
		http.Error(w, "Failed to create videos directory: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Save video clips JSON for the editor
	clipsData := map[string]interface{}{
		"storyboard":  req.Storyboard,
		"videoClips":  req.VideoClips,
		"generatedAt": time.Now().Format(time.RFC3339),
	}

	clipsJSON, err := json.MarshalIndent(clipsData, "", "  ")
	if err != nil {
		http.Error(w, "Failed to serialize clips data: "+err.Error(), http.StatusInternalServerError)
		return
	}

	clipsPath := filepath.Join(req.ProjectPath, "video-clips.json")
	if err := os.WriteFile(clipsPath, clipsJSON, 0644); err != nil {
		http.Error(w, "Failed to save clips file: "+err.Error(), http.StatusInternalServerError)
		return
	}

	slog.Info("saved video clips", "path", clipsPath, "clips", len(req.VideoClips))

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"success":   true,
		"path":      clipsPath,
		"clipCount": len(req.VideoClips),
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

// HandleUploadVideo uploads a video blob to the static videos directory and returns the URL
func (s *Server) HandleUploadVideo(w http.ResponseWriter, r *http.Request) {
	// Parse multipart form (max 500MB)
	if err := r.ParseMultipartForm(500 << 20); err != nil {
		http.Error(w, "Failed to parse form: "+err.Error(), http.StatusBadRequest)
		return
	}

	sceneIndex := r.FormValue("sceneIndex")
	if sceneIndex == "" {
		http.Error(w, "sceneIndex is required", http.StatusBadRequest)
		return
	}

	file, header, err := r.FormFile("video")
	if err != nil {
		http.Error(w, "Failed to get video file: "+err.Error(), http.StatusBadRequest)
		return
	}
	defer file.Close()

	// Create static videos directory if it doesn't exist
	staticVideosDir := filepath.Join(s.StaticDir, "videos")
	if err := os.MkdirAll(staticVideosDir, 0755); err != nil {
		http.Error(w, "Failed to create videos directory: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Determine file extension from content type or original filename
	ext := ".mp4"
	if header.Filename != "" {
		if strings.HasSuffix(strings.ToLower(header.Filename), ".webm") {
			ext = ".webm"
		} else if strings.HasSuffix(strings.ToLower(header.Filename), ".mov") {
			ext = ".mov"
		}
	}

	// Save with scene index as filename
	filename := fmt.Sprintf("scene_%s%s", sceneIndex, ext)
	filePath := filepath.Join(staticVideosDir, filename)

	// Read file content
	videoData, err := io.ReadAll(file)
	if err != nil {
		http.Error(w, "Failed to read video data: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Write to static directory
	if err := os.WriteFile(filePath, videoData, 0644); err != nil {
		http.Error(w, "Failed to save video file: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Return the static URL
	staticURL := fmt.Sprintf("/static/videos/%s", filename)
	slog.Info("uploaded video", "scene", sceneIndex, "path", filePath, "url", staticURL, "size", len(videoData))

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"success":  true,
		"videoUrl": staticURL,
		"filename": filename,
	})
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
	return fmt.Sprintf("https://storage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4#scene=%d", sceneIndex)
}

// Actual video generation using FFmpeg
type GenerateVideoRequest struct {
	ProjectPath    string `json:"projectPath"`
	SceneIndex     int    `json:"sceneIndex"`
	FirstFrameURL  string `json:"firstFrameUrl"`
	LastFrameURL   string `json:"lastFrameUrl"`
	Duration       int    `json:"duration"`
	Prompt         string `json:"prompt"`
}

func (s *Server) HandleGenerateVideo(w http.ResponseWriter, r *http.Request) {
	var req GenerateVideoRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request: "+err.Error(), http.StatusBadRequest)
		return
	}

	if req.FirstFrameURL == "" {
		http.Error(w, "First frame URL is required", http.StatusBadRequest)
		return
	}

	if req.Duration <= 0 {
		req.Duration = 5
	}

	// Create output directory
	outputDir := filepath.Join(req.ProjectPath, "videos")
	if req.ProjectPath == "" {
		outputDir = filepath.Join(os.TempDir(), "video-maker-clips")
	}
	if err := os.MkdirAll(outputDir, 0755); err != nil {
		http.Error(w, "Failed to create output directory: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Download first frame
	firstFramePath := filepath.Join(outputDir, fmt.Sprintf("scene_%d_first.png", req.SceneIndex))
	if err := downloadImage(req.FirstFrameURL, firstFramePath); err != nil {
		http.Error(w, "Failed to download first frame: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Download last frame if provided
	lastFramePath := ""
	if req.LastFrameURL != "" {
		lastFramePath = filepath.Join(outputDir, fmt.Sprintf("scene_%d_last.png", req.SceneIndex))
		if err := downloadImage(req.LastFrameURL, lastFramePath); err != nil {
			slog.Warn("Failed to download last frame", "error", err)
			lastFramePath = ""
		}
	}

	// Generate video
	outputPath := filepath.Join(outputDir, fmt.Sprintf("scene_%d.mp4", req.SceneIndex))
	if err := generateVideoWithFFmpeg(firstFramePath, lastFramePath, outputPath, req.Duration); err != nil {
		http.Error(w, "Failed to generate video: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Return the video URL
	videoURL := fmt.Sprintf("/static/videos/scene_%d.mp4", req.SceneIndex)
	
	// Copy to static directory for serving
	staticVideoDir := filepath.Join(s.StaticDir, "videos")
	os.MkdirAll(staticVideoDir, 0755)
	staticVideoPath := filepath.Join(staticVideoDir, fmt.Sprintf("scene_%d.mp4", req.SceneIndex))
	
	// Copy file
	input, _ := os.ReadFile(outputPath)
	os.WriteFile(staticVideoPath, input, 0644)

	slog.Info("generated video", "scene", req.SceneIndex, "path", staticVideoPath)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"success":  true,
		"videoUrl": videoURL,
		"status":   "ready",
		"message":  "Video generated!",
	})
}

func downloadImage(url string, destPath string) error {
	// Handle base64 data URLs
	if strings.HasPrefix(url, "data:image") {
		return saveBase64Image(url, destPath)
	}

	// Handle regular URLs
	resp, err := http.Get(url)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	out, err := os.Create(destPath)
	if err != nil {
		return err
	}
	defer out.Close()

	_, err = io.Copy(out, resp.Body)
	return err
}

func generateVideoWithFFmpeg(firstFrame, lastFrame, outputPath string, duration int) error {
	var cmd *exec.Cmd

	if lastFrame != "" {
		// Cross-fade between two images (image-to-image)
		// Creates a smooth transition from first to last frame
		filter := fmt.Sprintf(
			"[0:v]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1,zoompan=z='min(zoom+0.0015,1.2)':d=%d*30:s=1920x1080:fps=30[v0];" +
			"[1:v]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1,zoompan=z='if(lte(zoom,1.0),1.2,max(1.001,zoom-0.0015))':d=%d*30:s=1920x1080:fps=30[v1];" +
			"[v0][v1]xfade=transition=fade:duration=1:offset=%d[outv]",
			duration/2, duration/2, duration/2-1,
		)
		cmd = exec.Command("ffmpeg", "-y",
			"-loop", "1", "-i", firstFrame,
			"-loop", "1", "-i", lastFrame,
			"-filter_complex", filter,
			"-map", "[outv]",
			"-c:v", "libx264", "-pix_fmt", "yuv420p",
			"-t", fmt.Sprintf("%d", duration),
			outputPath,
		)
	} else {
		// Ken Burns effect on single image (zoom and pan)
		filter := fmt.Sprintf(
			"scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1," +
			"zoompan=z='min(zoom+0.001,1.3)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=%d*30:s=1920x1080:fps=30",
			duration,
		)
		cmd = exec.Command("ffmpeg", "-y",
			"-loop", "1", "-i", firstFrame,
			"-vf", filter,
			"-c:v", "libx264", "-pix_fmt", "yuv420p",
			"-t", fmt.Sprintf("%d", duration),
			outputPath,
		)
	}

	output, err := cmd.CombinedOutput()
	if err != nil {
		slog.Error("ffmpeg failed", "error", err, "output", string(output))
		return fmt.Errorf("ffmpeg error: %v - %s", err, string(output))
	}

	return nil
}

// Save project types
type SaveProjectRequest struct {
	ProjectPath   string                   `json:"projectPath"`
	StoryPrompt   string                   `json:"storyPrompt"`
	Characters    []map[string]any         `json:"characters"`
	ArtImages  []map[string]any         `json:"artImages"`
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
	for i, art := range req.ArtImages {
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
			req.ArtImages[i]["imageFile"] = filename
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

		// Save video if it exists
		videoURL, hasVideo := scene["videoUrl"].(string)
		if hasVideo && videoURL != "" {
			videoFilename := fmt.Sprintf("scene_%d.mp4", i+1)
			videoPath := filepath.Join(videosDir, videoFilename)
			
			if strings.HasPrefix(videoURL, "data:") {
				// Handle base64 video data
				if err := saveBase64Video(videoURL, videoPath); err != nil {
					slog.Warn("failed to save scene video", "error", err, "scene", i+1)
				} else {
					req.Scenes[i]["videoFile"] = videoFilename
					videoCount++
				}
			} else if strings.HasPrefix(videoURL, "blob:") {
				// Skip blob URLs - they need to be uploaded separately
				slog.Info("skipping blob URL for scene video", "scene", i+1)
			} else if strings.HasPrefix(videoURL, "/static/videos/") || strings.HasPrefix(videoURL, "http") {
				// Download from URL
				if err := downloadVideo(videoURL, videoPath, s.StaticDir); err != nil {
					slog.Warn("failed to download scene video", "error", err, "scene", i+1)
				} else {
					req.Scenes[i]["videoFile"] = videoFilename
					videoCount++
				}
			}
		}
	}

	// Build project data for JSON (without base64 data URLs)
	projectData := map[string]any{
		"storyPrompt":   req.StoryPrompt,
		"characters":    req.Characters,
		"artImages":  cleanImageURLs(req.ArtImages),
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

// Save editor project JSON alongside project.json
func (s *Server) HandleSaveEditorProject(w http.ResponseWriter, r *http.Request) {
	var req struct {
		ProjectPath   string         `json:"projectPath"`
		EditorProject map[string]any `json:"editorProject"`
		Filename      string         `json:"filename"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request: "+err.Error(), http.StatusBadRequest)
		return
	}

	if req.ProjectPath == "" {
		http.Error(w, "Project path is required", http.StatusBadRequest)
		return
	}

	// Create project directory if it doesn't exist
	if err := os.MkdirAll(req.ProjectPath, 0755); err != nil {
		http.Error(w, "Failed to create project directory: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Use provided filename or default to videoedit.vproj
	filename := req.Filename
	if filename == "" {
		filename = "videoedit.vproj"
	}
	jsonPath := filepath.Join(req.ProjectPath, filename)
	jsonData, err := json.MarshalIndent(req.EditorProject, "", "  ")
	if err != nil {
		http.Error(w, "Failed to create JSON: "+err.Error(), http.StatusInternalServerError)
		return
	}

	if err := os.WriteFile(jsonPath, jsonData, 0644); err != nil {
		http.Error(w, "Failed to write editor project: "+err.Error(), http.StatusInternalServerError)
		return
	}

	slog.Info("saved editor project", "path", jsonPath)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"success": true,
		"path":    jsonPath,
	})
}

// cleanImageURLs removes base64 data URLs from items, keeping only imageFile references
func cleanImageURLs(items []map[string]any) []map[string]any {
	result := make([]map[string]any, len(items))
	for i, item := range items {
		clean := make(map[string]any)
		for k, v := range item {
			// Skip base64 data URLs and blob URLs, keep everything else
			if k == "imageUrl" || k == "videoUrl" {
				if str, ok := v.(string); ok {
					if strings.HasPrefix(str, "data:") || strings.HasPrefix(str, "blob:") {
						continue
					}
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
	if artImages, ok := project["artImages"].([]any); ok {
		for i, art := range artImages {
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
						artImages[i] = artMap
					}
				}
			}
		}
		project["artImages"] = artImages
	}
	
	// Load scene/keyframe images and videos from disk
	// Check keyframes directory first, fall back to images directory
	keyframesDir := filepath.Join(projectPath, "keyframes")
	videosDir := filepath.Join(projectPath, "videos")
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
					}
				}
				
				// Try to load video by videoFile first, then by index
				videoFilename := ""
				if videoFile, ok := sceneMap["videoFile"].(string); ok && videoFile != "" {
					videoFilename = videoFile
				} else {
					videoFilename = fmt.Sprintf("scene_%d.mp4", i+1)
				}
				
				videoPath := filepath.Join(videosDir, videoFilename)
				if _, err := os.Stat(videoPath); err == nil {
					// Video exists - serve it via static path
					// Copy to static directory for serving
					staticVideoPath := filepath.Join("srv/static/videos", videoFilename)
					os.MkdirAll(filepath.Dir(staticVideoPath), 0755)
					if videoData, err := os.ReadFile(videoPath); err == nil {
						os.WriteFile(staticVideoPath, videoData, 0644)
						sceneMap["videoUrl"] = fmt.Sprintf("/static/videos/%s", videoFilename)
					}
				}
				
				scenes[i] = sceneMap
			}
		}
		project["scenes"] = scenes
	}
	
	// Check for videoedit.vproj and include it if it exists
	vprojPath := filepath.Join(projectPath, "videoedit.vproj")
	if vprojData, err := os.ReadFile(vprojPath); err == nil {
		var editorProject map[string]any
		if err := json.Unmarshal(vprojData, &editorProject); err == nil {
			project["editorProject"] = editorProject
			slog.Info("loaded videoedit.vproj", "path", vprojPath)
		}
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

func saveBase64Video(dataURL, filepath string) error {
	// Parse data URL: data:video/mp4;base64,xxxxx
	parts := strings.SplitN(dataURL, ",", 2)
	if len(parts) != 2 {
		return fmt.Errorf("invalid data URL format")
	}

	// Decode base64
	videoData, err := base64.StdEncoding.DecodeString(parts[1])
	if err != nil {
		return fmt.Errorf("failed to decode base64: %w", err)
	}

	// Write to file
	if err := os.WriteFile(filepath, videoData, 0644); err != nil {
		return fmt.Errorf("failed to write file: %w", err)
	}

	return nil
}

func downloadVideo(videoURL, destPath, staticDir string) error {
	var srcPath string
	
	if strings.HasPrefix(videoURL, "/static/videos/") {
		// Local static file
		srcPath = filepath.Join(staticDir, strings.TrimPrefix(videoURL, "/static/"))
	} else if strings.HasPrefix(videoURL, "http") {
		// Download from remote URL
		resp, err := http.Get(videoURL)
		if err != nil {
			return fmt.Errorf("failed to download video: %w", err)
		}
		defer resp.Body.Close()
		
		out, err := os.Create(destPath)
		if err != nil {
			return fmt.Errorf("failed to create video file: %w", err)
		}
		defer out.Close()
		
		_, err = io.Copy(out, resp.Body)
		return err
	} else {
		return fmt.Errorf("unsupported video URL format")
	}
	
	// Copy local file
	input, err := os.ReadFile(srcPath)
	if err != nil {
		return fmt.Errorf("failed to read source video: %w", err)
	}
	
	if err := os.WriteFile(destPath, input, 0644); err != nil {
		return fmt.Errorf("failed to write video file: %w", err)
	}
	
	return nil
}

func generateScenesWithCharacters(keyframes []Keyframe, storyPrompt string, characters []Character, artImages []ArtImages) []Scene {
	colors := []string{"1a1a2e", "16213e", "0f3460", "533483", "e94560", "2d4059", "3d5a80", "5c4d7d"}
	
	// Build character art lookup map
	artMap := make(map[int]string)
	for _, art := range artImages {
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
			imagePrompt := buildScenePrompt(kf.Description, characters, artImages)
			
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
		imagePrompt := buildScenePrompt(ds.prompt, characters, artImages)
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
func buildScenePrompt(sceneDescription string, characters []Character, artImages []ArtImages) string {
	prompt := sceneDescription
	
	if len(characters) > 0 {
		prompt += "\n\nCharacters in scene (use reference images for consistency):"
		for _, char := range characters {
			prompt += fmt.Sprintf("\n- %s", char.Description)
		}
	}
	
	if len(artImages) > 0 {
		prompt += fmt.Sprintf("\n\n[%d character reference image(s) provided for visual consistency]", len(artImages))
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

// GitHub integration handlers
type GitHubTestRequest struct {
	Username string `json:"username"`
	Token    string `json:"token"`
}

func (s *Server) HandleGitHubTest(w http.ResponseWriter, r *http.Request) {
	var req GitHubTestRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}

	if req.Username == "" || req.Token == "" {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"success": false,
			"error":   "Username and token are required",
		})
		return
	}

	// Test GitHub API connection
	client := &http.Client{Timeout: 10 * time.Second}
	apiReq, _ := http.NewRequest("GET", "https://api.github.com/user", nil)
	apiReq.Header.Set("Authorization", "token "+req.Token)
	apiReq.Header.Set("Accept", "application/vnd.github.v3+json")

	resp, err := client.Do(apiReq)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"success": false,
			"error":   "Failed to connect to GitHub: " + err.Error(),
		})
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"success": false,
			"error":   fmt.Sprintf("GitHub authentication failed (status %d)", resp.StatusCode),
		})
		return
	}

	var userData map[string]any
	json.NewDecoder(resp.Body).Decode(&userData)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"success": true,
		"user":    userData["login"],
	})
}

type GitHubPushRequest struct {
	Username   string `json:"username"`
	Token      string `json:"token"`
	Repo       string `json:"repo"`
	Branch     string `json:"branch"`
	CreateRepo bool   `json:"createRepo"`
}

func (s *Server) HandleGitHubPush(w http.ResponseWriter, r *http.Request) {
	var req GitHubPushRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}

	if req.Username == "" || req.Token == "" || req.Repo == "" {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"success": false,
			"error":   "Username, token, and repo are required",
		})
		return
	}

	if req.Branch == "" {
		req.Branch = "main"
	}

	// Source code path
	sourcePath := "/home/exedev/video-maker"
	repoURL := fmt.Sprintf("https://%s:%s@github.com/%s/%s.git", req.Username, req.Token, req.Username, req.Repo)
	publicRepoURL := fmt.Sprintf("https://github.com/%s/%s", req.Username, req.Repo)

	// Create repository if requested
	if req.CreateRepo {
		if err := createGitHubRepo(req.Username, req.Token, req.Repo); err != nil {
			slog.Warn("failed to create repo (may already exist)", "error", err)
			// Continue anyway - repo might already exist
		}
	}

	// Configure git user if not set
	exec.Command("git", "-C", sourcePath, "config", "user.email", "developer@video-maker.local").Run()
	exec.Command("git", "-C", sourcePath, "config", "user.name", "Video Maker Developer").Run()

	// Check if remote exists, update or add it
	checkRemote := exec.Command("git", "-C", sourcePath, "remote", "get-url", "origin")
	if err := checkRemote.Run(); err != nil {
		// Remote doesn't exist, add it
		if err := exec.Command("git", "-C", sourcePath, "remote", "add", "origin", repoURL).Run(); err != nil {
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]any{
				"success": false,
				"error":   "Failed to add git remote: " + err.Error(),
			})
			return
		}
	} else {
		// Update existing remote
		exec.Command("git", "-C", sourcePath, "remote", "set-url", "origin", repoURL).Run()
	}

	// Stage all changes
	addCmd := exec.Command("git", "-C", sourcePath, "add", "-A")
	if output, err := addCmd.CombinedOutput(); err != nil {
		slog.Warn("git add warning", "output", string(output))
	}

	// Commit (if there are changes)
	commitMsg := fmt.Sprintf("Update video-maker source code - %s", time.Now().Format("2006-01-02 15:04:05"))
	commitCmd := exec.Command("git", "-C", sourcePath, "commit", "-m", commitMsg, "--allow-empty")
	if output, err := commitCmd.CombinedOutput(); err != nil {
		slog.Info("git commit", "output", string(output))
	}

	// Push to GitHub
	pushCmd := exec.Command("git", "-C", sourcePath, "push", "-u", "origin", req.Branch, "--force")
	output, err := pushCmd.CombinedOutput()
	if err != nil {
		slog.Error("git push failed", "error", err, "output", string(output))
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"success": false,
			"error":   "Failed to push: " + string(output),
		})
		return
	}

	slog.Info("successfully pushed to GitHub", "repo", publicRepoURL)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"success": true,
		"repoUrl": publicRepoURL,
		"branch":  req.Branch,
	})
}

func createGitHubRepo(username, token, repoName string) error {
	client := &http.Client{Timeout: 10 * time.Second}
	
	reqBody, _ := json.Marshal(map[string]any{
		"name":        repoName,
		"description": "Video Maker - AI-powered video story creation tool",
		"private":     false,
		"auto_init":   false,
	})
	
	req, _ := http.NewRequest("POST", "https://api.github.com/user/repos", strings.NewReader(string(reqBody)))
	req.Header.Set("Authorization", "token "+token)
	req.Header.Set("Accept", "application/vnd.github.v3+json")
	req.Header.Set("Content-Type", "application/json")
	
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	
	if resp.StatusCode != 201 && resp.StatusCode != 422 { // 422 means repo already exists
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("failed to create repo: %s", string(body))
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
	mux.HandleFunc("POST /api/generate-art-images", s.HandleGenerateArtImages)
	mux.HandleFunc("POST /api/generate-video-clips", s.HandleGenerateVideoClips)
	mux.HandleFunc("POST /api/save-project", s.HandleSaveProject)
	mux.HandleFunc("POST /api/save-editor-project", s.HandleSaveEditorProject)
	mux.HandleFunc("POST /api/save-keyframe", s.HandleSaveKeyframe)
	mux.HandleFunc("POST /api/generate-video", s.HandleGenerateVideo)
	mux.HandleFunc("POST /api/save-video-clips", s.HandleSaveVideoClips)
	mux.HandleFunc("POST /api/upload-video", s.HandleUploadVideo)
	mux.HandleFunc("GET /api/load-project", s.HandleLoadProject)
	mux.HandleFunc("GET /api/browse-folders", s.HandleBrowseFolders)
	
	// GitHub integration
	mux.HandleFunc("POST /api/github/test", s.HandleGitHubTest)
	mux.HandleFunc("POST /api/github/push", s.HandleGitHubPush)

	// Static files
	mux.Handle("/static/", http.StripPrefix("/static/", http.FileServer(http.Dir(s.StaticDir))))
	
	slog.Info("starting server", "addr", addr)
	return http.ListenAndServe(addr, mux)
}
