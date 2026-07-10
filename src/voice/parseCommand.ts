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

/** Explicit 6-joint target pose. Angles are supplied in degrees. */
export interface JointPose {
  type: 'joint_pose';
  angles: number[];
}

export interface ResetArm {
  type: 'reset';
}

/** An ordered plan produced by the optional agentic voice layer. */
export interface CommandSequence {
  type: 'sequence';
  commands: Array<MoveRelative | GotoAbsolute | GotoKey | RotateJoint | JointPose | ResetArm>;
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
  | JointPose
  | ResetArm
  | CommandSequence
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

3. Go to a test-panel position:
   Use the supplied panel coordinates and output a direct goto object.
   Example: "go to position 3" -> {"type":"goto","x":0.600,"y":0.050,"z":-0.050}

4. Rotate a specific joint:
   {"type":"rotate_joint","joint":<1-6>,"degrees":<signed degrees>}
   Example: "rotate the base 30 degrees" → {"type":"rotate_joint","joint":1,"degrees":30}

5. Reset:
   {"type":"reset"}
   "reset the arm", "go home"

6. Multi-step instruction (only when multiple actions are explicit):
   {"type":"sequence","commands":[<commands from 1-5>]}
   Example: "move up 2cm, then rotate base 15 degrees" ->
   {"type":"sequence","commands":[{"type":"move_relative","axis":"y","value":0.02},{"type":"rotate_joint","joint":1,"degrees":15}]}

7. Explicit joint pose (only when all six joint angles are explicitly requested):
   {"type":"joint_pose","angles":[J1,J2,J3,J4,J5,J6]}
   Angles are degrees and must be six finite numbers.

IMPORTANT RULES:
- Do not output goto_key. Convert references to a panel position/key directly into a goto with its listed world coordinates.
- For relative requests, use the current end-effector position supplied in the context to calculate an absolute goto target whenever possible.
- If the target is ambiguous and no safe coordinate can be inferred, return unknown and ask for the missing coordinate; do not write an explanation before the JSON.
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
export async function parseWithLLM(
  transcript: string,
  signal?: AbortSignal,
  context?: { currentPosition: { x: number; y: number; z: number } },
): Promise<ParseResult> {
  const position = context?.currentPosition;
  const runtimeContext = position
    ? `Live scene context (Three.js world coordinates, Y-up): end effector is at (${position.x.toFixed(3)}, ${position.y.toFixed(3)}, ${position.z.toFixed(3)}). Test panel positions: key/position 1=(0.500,0.050,-0.050), 2=(0.550,0.050,-0.050), 3=(0.600,0.050,-0.050), 4=(0.500,0.050,0.050), 5=(0.550,0.050,0.050), 6=(0.600,0.050,0.050).`
    : 'No live pose is available. Do not infer a relative target.';
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
          content: `${runtimeContext}\n\nOperator instruction: ${transcript}`,
        },
      ],
      temperature: 0.1,
      max_tokens: 300,
      response_format: { type: 'json_object' },
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
      const objectMatch = content.match(/\{[\s\S]*\}/);
      if (!objectMatch) {
        throw new Error('The language model did not return a JSON command. Please repeat the command with a target or coordinate.');
      }
      try {
        parsed = JSON.parse(objectMatch[0]);
      } catch {
        throw new Error('The language model returned invalid JSON. Please repeat the command.');
      }
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
    case 'joint_pose': {
      if (!Array.isArray(command.angles) || command.angles.length !== 6 || command.angles.some(angle => !Number.isFinite(angle))) {
        return { command: { type: 'unknown', explanation: 'A joint pose must contain exactly six finite angles in degrees' }, raw: content };
      }
      break;
    }
    case 'reset':
    case 'unknown':
      break;
    case 'sequence': {
      if (!Array.isArray(command.commands) || command.commands.length === 0 || command.commands.length > 8) {
        return { command: { type: 'unknown', explanation: 'A sequence must contain 1 to 8 commands' }, raw: content };
      }
      const invalidStep = command.commands.some(step => {
        if (!step || !step.type) return true;
        if (step.type === 'move_relative') return !['x', 'y', 'z'].includes(step.axis) || !Number.isFinite(step.value);
        if (step.type === 'goto') return !Number.isFinite(step.x) || !Number.isFinite(step.y) || !Number.isFinite(step.z);
        if (step.type === 'goto_key') return ![1, 2, 3, 4, 5, 6].includes(step.key);
        if (step.type === 'rotate_joint') return step.joint < 1 || step.joint > 6 || !Number.isFinite(step.degrees);
        if (step.type === 'joint_pose') return !Array.isArray(step.angles) || step.angles.length !== 6 || step.angles.some(angle => !Number.isFinite(angle));
        return step.type !== 'reset';
      });
      if (invalidStep) {
        return { command: { type: 'unknown', explanation: 'Sequence contains an invalid or unsupported step' }, raw: content };
      }
      break;
    }
    default:
      return { command: { type: 'unknown', explanation: `Unrecognised command type: ${(command as any).type}` }, raw: content };
  }

  return { command, raw: content };
}
