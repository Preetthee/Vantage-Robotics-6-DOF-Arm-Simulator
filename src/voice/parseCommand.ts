/**
 * parseCommand — Send transcribed voice text to a Fireworks AI LLM and
 * interpret it as a structured motion command for the robot arm.
 *
 * The LLM is prompted to output JSON in one of a few recognised command
 * formats, which is then parsed and returned as a `VoiceCommand`.
 */

import { FIREWORKS_API_KEY, FIREWORKS_MODEL, FIREWORKS_BASE_URL } from '../constants/config';

// ─── Command types ───────────────────────────────────────────────────

export interface MoveRelative {
  type: 'move_relative';
  /** Axis in world space: 'x', 'y', or 'z' */
  axis: 'x' | 'y' | 'z';
  /** Signed delta in metres (e.g. 0.02 = 2cm) */
  value: number;
}

export interface GotoAbsolute {
  type: 'goto';
  /** Target position in metres (Three.js world coordinates, Y-up) */
  x: number;
  y: number;
  z: number;
}

export interface GotoKey {
  type: 'goto_key';
  /** Key number 1–6 */
  key: number;
}

export interface RotateJoint {
  type: 'rotate_joint';
  /** Joint index 1–6 (J1 = base, J6 = wrist) */
  joint: number;
  /** Signed degrees to rotate */
  degrees: number;
}

export interface ResetArm {
  type: 'reset';
}

export interface UnknownCommand {
  type: 'unknown';
  /** Human-readable explanation of why the command wasn't understood */
  explanation: string;
}

export type VoiceCommand =
  | MoveRelative
  | GotoAbsolute
  | GotoKey
  | RotateJoint
  | ResetArm
  | UnknownCommand;

// ─── System prompt ──────────────────────────────────────────────────

const SYSTEM_PROMPT = `You control a 6-DOF robotic arm (Vantage Robotics). The user gives you a natural-language instruction, and you must output a JSON command to move the arm.

Available commands (output ONLY valid JSON — no markdown, no code fences):

1. Move relative (jog):
   {"type":"move_relative","axis":"x"|"y"|"z","value":<signed metres>}
   Examples: "move up 2cm" → {"type":"move_relative","axis":"y","value":0.02}
             "go left 5cm" → {"type":"move_relative","axis":"x","value":-0.05}
             "move forward" → {"type":"move_relative","axis":"z","value":-0.03}

2. Go to absolute position:
   {"type":"goto","x":<metres>,"y":<metres>,"z":<metres>}
   The key panel is at x=0.5-0.6, y=0.04-0.06, z=0.05.

3. Go to a key on the test panel:
   {"type":"goto_key","key":<1-6>}
   Examples: "go to key 3" or "press key 5"

4. Rotate a specific joint:
   {"type":"rotate_joint","joint":<1-6>,"degrees":<signed degrees>}
   Example: "rotate the base 30 degrees" → {"type":"rotate_joint","joint":1,"degrees":30}

5. Reset:
   {"type":"reset"}
   "reset the arm", "go home"

IMPORTANT RULES:
- Value for move_relative is in METRES (not cm). Convert cm to metres by dividing by 100.
- If the user says "forward" it means negative Z (into the scene), "back" means positive Z.
- If the user says something unclear, output: {"type":"unknown","explanation":"<why you couldn't understand>"}
- Output ONLY valid JSON — no other text.`;

// ─── Parser ──────────────────────────────────────────────────────────

export interface ParseResult {
  command: VoiceCommand;
  raw: string;
}

/**
 * Send the transcribed speech to Fireworks AI and return a parsed command.
 * Throws on network errors or invalid responses.
 */
export async function parseWithLLM(transcript: string, signal?: AbortSignal): Promise<ParseResult> {
  const response = await fetch(`${FIREWORKS_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${FIREWORKS_API_KEY}`,
    },
    body: JSON.stringify({
      model: FIREWORKS_MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: transcript,
        },
      ],
      temperature: 0.1,
      max_tokens: 300,
    }),
    signal,
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Fireworks API error ${response.status}: ${body}`);
  }

  const data = await response.json();
  const content: string = data?.choices?.[0]?.message?.content ?? '';

  if (!content) {
    throw new Error('Empty response from Fireworks API');
  }

  // Parse the response — it should be pure JSON
  let parsed: any;
  try {
    parsed = JSON.parse(content.trim());
  } catch {
    // Try to extract JSON from markdown code blocks
    const match = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (match) {
      try {
        parsed = JSON.parse(match[1].trim());
      } catch {
        throw new Error(`Could not parse LLM response as JSON:\n${content}`);
      }
    } else {
      throw new Error(`Could not parse LLM response as JSON:\n${content}`);
    }
  }

  // Validate the response shape
  if (!parsed || typeof parsed !== 'object' || !parsed.type) {
    return {
      command: { type: 'unknown', explanation: 'LLM returned an unexpected format' },
      raw: content,
    };
  }

  // Type-narrow based on the command
  const command = parsed as VoiceCommand;

  // Validate required fields per type
  switch (command.type) {
    case 'move_relative': {
      if (!['x', 'y', 'z'].includes(command.axis)) {
        return { command: { type: 'unknown', explanation: `Invalid axis: ${command.axis}` }, raw: content };
      }
      if (typeof command.value !== 'number' || isNaN(command.value)) {
        return { command: { type: 'unknown', explanation: 'Missing or invalid value for move_relative' }, raw: content };
      }
      break;
    }
    case 'goto': {
      if (typeof command.x !== 'number' || typeof command.y !== 'number' || typeof command.z !== 'number') {
        return { command: { type: 'unknown', explanation: 'Missing or invalid coordinates for goto' }, raw: content };
      }
      break;
    }
    case 'goto_key': {
      if (![1, 2, 3, 4, 5, 6].includes(command.key)) {
        return { command: { type: 'unknown', explanation: `Invalid key number: ${command.key}. Use 1–6.` }, raw: content };
      }
      break;
    }
    case 'rotate_joint': {
      if (command.joint < 1 || command.joint > 6) {
        return { command: { type: 'unknown', explanation: `Invalid joint: ${command.joint}. Use 1–6.` }, raw: content };
      }
      if (typeof command.degrees !== 'number' || isNaN(command.degrees)) {
        return { command: { type: 'unknown', explanation: 'Missing or invalid degrees for rotate_joint' }, raw: content };
      }
      break;
    }
    case 'reset':
    case 'unknown':
      break;
    default:
      return { command: { type: 'unknown', explanation: `Unrecognised command type: ${(command as any).type}` }, raw: content };
  }

  return { command, raw: content };
}