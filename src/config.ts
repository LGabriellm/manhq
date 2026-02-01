import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  JWT_SECRET: z.string().min(1, "JWT_SECRET é obrigatório."),
  CORS_ORIGIN: z.string().optional(),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().optional(),
  RATE_LIMIT_WINDOW: z.string().optional(),
  BODY_LIMIT_MB: z.coerce.number().positive().optional(),
  FILE_UPLOAD_LIMIT_MB: z.coerce.number().positive().optional(),
  LIBRARY_PATH: z.string().min(1, "LIBRARY_PATH é obrigatório."),
  TEMP_PATH: z.string().min(1, "TEMP_PATH é obrigatório."),
});

const env = envSchema.parse(process.env);

const corsOrigins = env.CORS_ORIGIN
  ? env.CORS_ORIGIN.split(",")
      .map((origin) => origin.trim())
      .filter(Boolean)
  : null;

export const config = {
  jwtSecret: env.JWT_SECRET,
  corsOrigins,
  rateLimit: {
    max: env.RATE_LIMIT_MAX ?? 100,
    timeWindow: env.RATE_LIMIT_WINDOW ?? "1 minute",
  },
  bodyLimit: (env.BODY_LIMIT_MB ?? 100) * 1024 * 1024,
  fileUploadLimit: (env.FILE_UPLOAD_LIMIT_MB ?? 100) * 1024 * 1024,
  libraryPath: env.LIBRARY_PATH,
  tempPath: env.TEMP_PATH,
};
