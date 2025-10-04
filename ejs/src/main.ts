import { getFromPrepared, preprocessPlayer } from "./solvers.ts";
import { isOneOf } from "./utils.ts";

// Pre-computed cache for preprocessed players
const PREPROCESSED_CACHE = new Map<string, string>();
// Post-execution cache for solver results
const SOLVER_RESULT_CACHE = new Map<string, string>();
// Cache for solver functions themselves
const SOLVER_FUNC_CACHE = new Map<string, ReturnType<typeof getFromPrepared>>();

const MAX_CACHE_SIZE = 100;
const CACHE_KEY_SEPARATOR = ":";

function getCacheKey(type: string, challenge: string): string {
  return `${type}${CACHE_KEY_SEPARATOR}${challenge}`;
}

function pruneCache(cache: Map<string, unknown>): void {
  if (cache.size > MAX_CACHE_SIZE) {
    const keysToDelete = Array.from(cache.keys()).slice(0, cache.size - MAX_CACHE_SIZE);
    keysToDelete.forEach(key => cache.delete(key));
  }
}

export default function main(input: Input): Output {
  let preprocessedPlayer: string;
  let playerHash: string;

  // Level 1: Preprocessed player cache
  if (input.type === "player") {
    playerHash = hashString(input.player);
    const cached = PREPROCESSED_CACHE.get(playerHash);

    if (cached) {
      preprocessedPlayer = cached;
    } else {
      preprocessedPlayer = preprocessPlayer(input.player);
      PREPROCESSED_CACHE.set(playerHash, preprocessedPlayer);
      pruneCache(PREPROCESSED_CACHE);
    }
  } else {
    preprocessedPlayer = input.preprocessed_player;
    playerHash = hashString(preprocessedPlayer);
  }

  // Level 2: Solver function cache
  let solvers = SOLVER_FUNC_CACHE.get(playerHash);
  if (!solvers) {
    solvers = getFromPrepared(preprocessedPlayer);
    SOLVER_FUNC_CACHE.set(playerHash, solvers);
    pruneCache(SOLVER_FUNC_CACHE);
  }

  const responses = input.requests.map((request): Response => {
    if (!isOneOf(request.type, "nsig", "sig")) {
      return {
        type: "error",
        error: `Unknown request type: ${request.type}`
      };
    }

    const solver = solvers[request.type];
    if (!solver) {
      return {
        type: "error",
        error: `Failed to extract ${request.type} function`
      };
    }

    try {
      const data: Record<string, string> = {};

      // Level 3: Result cache for individual challenges
      for (const challenge of request.challenges) {
        const cacheKey = getCacheKey(request.type, challenge);
        let result = SOLVER_RESULT_CACHE.get(cacheKey);

        if (result === undefined) {
          result = solver(challenge);
          SOLVER_RESULT_CACHE.set(cacheKey, result);
          pruneCache(SOLVER_RESULT_CACHE);
        }

        data[challenge] = result;
      }

      return {
        type: "result",
        data
      };
    } catch (error) {
      return {
        type: "error",
        error: error instanceof Error
          ? `${error.message}\n${error.stack}`
          : String(error)
      };
    }
  });

  const output: Output = {
    type: "result",
    responses
  };

  if (input.type === "player" && input.output_preprocessed) {
    output.preprocessed_player = preprocessedPlayer;
  }

  return output;
}

// Fast hash function for cache keys (djb2 algorithm)
function hashString(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) + str.charCodeAt(i);
    hash = hash >>> 0;
  }
  return hash.toString(36);
}

export type Input =
  | {
    type: "player";
    player: string;
    requests: Request[];
    output_preprocessed: boolean;
  }
  | {
    type: "preprocessed";
    preprocessed_player: string;
    requests: Request[];
  };

type Request = {
  type: "nsig" | "sig";
  challenges: string[];
};

type Response =
  | {
    type: "result";
    data: Record<string, string>;
  }
  | {
    type: "error";
    error: string;
  };

export type Output =
  | {
    type: "result";
    preprocessed_player?: string;
    responses: Response[];
  }
  | {
    type: "error";
    error: string;
  };