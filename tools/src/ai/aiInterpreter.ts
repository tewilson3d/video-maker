import OpenAI from 'openai';
import { Project } from '../types';

// !!! IMPORTANT: Replace with your actual OpenAI API key !!!
// TODO: Move API Key to environment variable or configuration
const apiKey = "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"; // Add your OpenAI API key here

const systemPrompt = `You are an AI assistant that helps users edit video projects in FrameForge video editor. Your task is to interpret user commands and modify the provided project JSON to implement the requested changes.

## FrameForge Project Structure

You will receive a JSON project with this structure:
- \`assets\`: Array of video, audio, and image assets
- \`timeline\`: Contains tracks with clips, each clip has timing, keyframes, and properties
- \`canvasWidth/Height\`: Canvas dimensions
- \`backgroundColor\`: Background color

## Available Editing Operations

### Timing Operations
- Move clips to different positions
- Change clip duration, in/out points
- Adjust playback speed (\`playbackSpeed\`: 1.0 = normal, 0.5 = half speed, 2.0 = double speed)
- Reverse clips (\`reversed\`: true/false)

### Animation & Effects
- **Transform keyframes**: Position (x,y), rotation (degrees), scale (x,y), opacity (0-1)
- **Audio keyframes**: Volume (0-1)
- **Easing**: "linear", "ease-in", "ease-out", "ease-in-out"

### Track Operations
- Add/remove/reorder tracks
- Show/hide tracks (\`visible\`: true/false)
- Lock/unlock tracks (\`locked\`: true/false)

### Project Settings
- Change canvas dimensions
- Modify background color
- Adjust timeline duration and FPS

## Command Examples

**"Make the first clip fade in over 2 seconds"**
→ Add opacity keyframes: time 0 = 0, time 2 = 1

**"Slow down the second clip to half speed"**
→ Set \`playbackSpeed\` to 0.5

**"Move the music track to start at 5 seconds"**
→ Change audio clip \`start\` to 5

**"Make the video zoom in gradually"**
→ Add scale keyframes: time 0 = { "scaleX": 0.5, "scaleY": 0.5 }, time end = { "scaleX": 1.0, "scaleY": 1.0 }

**"Lower the music volume during the first 10 seconds"**
→ Add volume keyframes: time 0 = 0.3, time 10 = 0.8

## Response Format

Respond ONLY with a valid JSON object representing the COMPLETE modified project. The response must:
- Be valid JSON that matches the Project interface
- Include ALL original data (don't remove existing assets/tracks/clips)
- Only modify the specific elements requested
- Preserve asset IDs and references
- Maintain proper keyframe structure with time, value, and easing

## Keyframe Structure
\`\`\`typescript
{
  "keyframes": {
    "position": [{ "time": 0, "value": { "x": 0, "y": 0 }, "easing": "linear" }],
    "rotation": [{ "time": 0, "value": 0, "easing": "linear" }],
    "scale": [{ "time": 0, "value": { "scaleX": 1, "scaleY": 1 }, "easing": "linear" }],
    "opacity": [{ "time": 0, "value": 1, "easing": "linear" }]
  },
  "audioKeyframes": {
    "volume": [{ "time": 0, "value": 0.8, "easing": "linear" }]
  }
}
\`\`\`

## Important Rules
- Always preserve existing assets and their IDs
- Times are in seconds (not frames)
- Keyframe times are relative to clip start
- Don't add assets - only modify existing ones
- If a request is unclear, make reasonable assumptions
- If impossible, return the original project unchanged
- CRITICAL: Scale keyframes must always use "scaleX" and "scaleY" properties, never "x" and "y"

Analyze the user command and project context, then output ONLY the modified project JSON.`;

let openai: OpenAI | null = null;

try {
    if (!apiKey) {
        console.warn("OpenAI API key is missing. AI Interpreter will be disabled. Please add your key in src/ai/aiInterpreter.ts");
        openai = null;
    } else {
        openai = new OpenAI({
            apiKey: apiKey,
            dangerouslyAllowBrowser: true // Necessary for client-side usage, be cautious!
        });
    }
} catch (error) {
    console.error("Failed to initialize OpenAI client:", error);
    openai = null;
}

/**
 * Sends the user command and current project to OpenAI and expects a modified project JSON in return.
 * @param command The user's text command (e.g., "make the first clip fade in").
 * @param currentProject The current project state.
 * @returns A Promise resolving to the modified Project or null if an error occurs.
 */
export async function interpretVideoEditCommand(
    command: string,
    currentProject: Project
): Promise<Project | null> {
    if (!openai) {
        console.error("OpenAI client not initialized. Cannot interpret command.");
        return null;
    }

    try {
        // Simplify project JSON to reduce token usage
        const simplifiedProject = {
            ...currentProject,
            assets: currentProject.assets.map(asset => ({
                id: asset.id,
                name: asset.name,
                type: asset.type,
                duration: asset.duration,
                // Remove large fields like thumbnails, waveforms, elements
            }))
        };

        const userMessageContent = `User Command: "${command}"

Current Project JSON:
${JSON.stringify(simplifiedProject, null, 2)}`;

        console.log("Sending to AI (User Command):", command);
        console.log("Request payload size:", userMessageContent.length, "characters");

        // Try GPT-4o first, fallback to GPT-3.5-turbo if it fails
        let completion;
        try {
            console.log("Trying GPT-4.1-mini...");
            completion = await openai.chat.completions.create({
                model: "gpt-4.1-mini",
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: userMessageContent }
                ],
                temperature: 0.1,
                response_format: { type: "json_object" },
                max_tokens: 32768,
            });
        } catch (gpt4Error) {
            console.warn("GPT-4o failed, trying GPT-4.1:", gpt4Error);
            completion = await openai.chat.completions.create({
                model: "gpt-4.1",
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: userMessageContent }
                ],
                temperature: 0.1,
                response_format: { type: "json_object" },
                max_tokens: 32768,
            });
        }

        const responseContent = completion.choices[0]?.message?.content;
        console.log("Raw AI Response received:", responseContent ? "Success" : "Empty response");
        console.log("Response length:", responseContent?.length || 0, "characters");

        if (!responseContent) {
            console.error("OpenAI response content is empty.");
            return null;
        }

        try {
            // Parse the JSON response directly into Project
            const parsedResponse = JSON.parse(responseContent);

            // Basic validation: Check if it has required project fields
            if (parsedResponse.id && parsedResponse.name && parsedResponse.assets && parsedResponse.timeline) {
                console.log("Successfully parsed AI response");
                return parsedResponse as Project;
            } else {
                console.error("Parsed OpenAI response does not match Project structure");
                return null;
            }

        } catch (parseError) {
            console.error("Failed to parse OpenAI JSON response:", parseError);
            console.error("Raw response content:", responseContent);
            return null;
        }

    } catch (error) {
        console.error("Error calling OpenAI API:", error);
        
        // More detailed error logging
        if (error instanceof Error) {
            console.error("Error message:", error.message);
            console.error("Error stack:", error.stack);
        }
        
        // Check for specific API errors
        if ((error as any)?.error?.message) {
            console.error("OpenAI API error message:", (error as any).error.message);
        }
        
        if ((error as any)?.status) {
            console.error("HTTP status:", (error as any).status);
        }
        
        return null;
    }
}

/**
 * Check if the AI interpreter is available
 */
export function isAIAvailable(): boolean {
    return openai !== null;
} 