# Agent Image Generation Design

## Summary

Add image generation as an agent-controlled capability. The frontend only provides a one-request permission toggle, persistent image model settings, image event handling, and vault file saving. The backend agent decides when to call the image generation tool and references generated images in its own Markdown answer.

## Goals

- Let users enable image generation explicitly for a single request.
- Keep the existing floating prompt workflow; do not add a separate image mode or image-generation modal.
- Let the backend agent decide whether image generation is needed.
- Save generated images into the same folder as the active note.
- Let the agent reference generated images using Obsidian embed syntax, such as `![[cover.png]]`.
- Limit the number of images generated in one request.

## Non-Goals

- Do not add frontend-only image generation commands for the first version.
- Do not require a frontend acknowledgement round trip before the agent continues answering.
- Do not guarantee that the agent's guessed link always matches a frontend-renamed collision file.
- Do not let the agent choose arbitrary vault directories.

## Frontend UX

The floating box context line becomes a horizontal control row above the input:

```text
[@ current-file.md] [Allow image generation]
[prompt input]
```

The current file indicator keeps the existing context role but uses a lightweight button or pill style. Long paths are truncated with ellipsis.

The image generation control is a runtime-only toggle:

- Off by default.
- Manually enabled by the user before each request that may generate images.
- Disabled while a request is running.
- Automatically turned off after the request completes, fails, or is cancelled.
- If no image generation model is configured, clicking the toggle shows a notice and leaves it off.

Persistent settings:

```ts
imageGenerationModelId: string | null;
maxImagesPerRequest: number;
```

Runtime-only state:

```ts
allowImageGenerationForNextRequest: boolean;
```

## Request Contract

The existing chat request includes an optional image generation block:

```json
{
  "image_generation": {
    "enabled": true,
    "model_id": "model-provider-id",
    "max_images": 3
  }
}
```

When disabled:

```json
{
  "image_generation": {
    "enabled": false
  }
}
```

The backend treats `enabled=false` or a missing block as no image permission.

## Backend Agent Behavior

The backend only exposes or enables the image generation tool when `image_generation.enabled` is true and `model_id` is present.

The tool call should let the agent specify both prompt and filename:

```json
{
  "prompt": "A cyberpunk rainy street cover image",
  "filename": "cyberpunk-rainy-street"
}
```

Tool instructions should tell the agent:

- `filename` must be short, concrete, and unique within the answer.
- `filename` must not include a path or extension.
- The final answer should reference generated images with `![[filename.png]]`.
- If multiple images are needed, call the tool multiple times with distinct filenames.

The backend strictly enforces `max_images`. Once the request reaches the limit, further image tool calls return a refusal tool result, while the agent may continue its text answer.

## Image SSE Event

When an image is generated, the backend sends an SSE event:

```text
event: image_generated
data: {
  "filename": "cyberpunk-rainy-street",
  "mime_type": "image/png",
  "base64": "..."
}
```

The event is one-way. The frontend does not send a save acknowledgement back to the backend.

## Frontend Image Saving

The frontend receives `image_generated`, sanitizes the filename, appends the file extension inferred from `mime_type`, and saves the binary image to the active note's folder.

Example:

```text
Notes/AI/current-note.md
Notes/AI/cyberpunk-rainy-street.png
```

If the file exists, the frontend creates a unique filename:

```text
cyberpunk-rainy-street.png
cyberpunk-rainy-street-1.png
cyberpunk-rainy-street-2.png
```

The frontend does not rewrite the agent answer if collision renaming changes the final filename. Users can manually fix rare mismatches.

## Answer Rendering

The agent owns placement of image links in the final Markdown answer. The expected syntax is:

```md
![[cyberpunk-rainy-street.png]]
```

The frontend should not independently insert image links into the note based only on image events. Its responsibility is saving the received image files.

## Error Handling

- If image generation is disabled, image tool calls are unavailable or return a permission error.
- If no image model is configured, the frontend cannot enable the runtime toggle.
- If the backend reaches `max_images`, later image tool calls are refused for that request.
- If the frontend cannot save an image, it shows a notice and records the error in the floating box error area when possible.
- Text streaming should continue when image saving fails unless the stream itself fails.

## Testing Notes

Frontend tests should cover:

- Runtime toggle resets after request completion and failure.
- Request payload includes image generation settings only when enabled.
- Filename sanitization, extension selection, same-folder path resolution, and collision handling.
- `image_generated` SSE events are parsed and saved without injecting links.

Backend tests should cover:

- Disabled image generation blocks image tool usage.
- Enabled image generation includes the configured model id and max image limit.
- The per-request image count limit refuses excess tool calls.
- SSE image events include filename, MIME type, and base64 payload.
