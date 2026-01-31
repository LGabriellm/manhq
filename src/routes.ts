import Fastify from "fastify";
import { LibraryController } from "./controllers/LibraryController.ts";
import { ReaderController } from "./controllers/ReaderController.ts";
import { ScannerService } from "./services/Scanner.ts";
import { UploadController } from "./controllers/UploadController.ts";
import { AuthController } from "./controllers/AuthController.ts"; // Novo
import { authMiddleware } from "./middlewares/auth.ts"; // Novo
import { z } from "zod"; // Novo

const libraryCtrl = new LibraryController();
const readerCtrl = new ReaderController();
const scannerSvc = new ScannerService();
const uploadCtrl = new UploadController();
const authCtrl = new AuthController();

export async function appRoutes(app: Fastify.FastifyInstance) {
  // --- ROTAS PÚBLICAS (Qualquer um acessa) ---
  app.post("/register", {
    schema: {
      body: z.object({
        name: z.string().min(3, "Nome muito curto"),
        email: z.string().email("E-mail inválido"),
        password: z.string().min(6, "Senha deve ter no mínimo 6 caracteres"),
      }),
    },
    handler: authCtrl.register,
  });
  app.post("/login", {
    schema: {
      body: z.object({
        email: z.string().email("E-mail inválido"),
        password: z.string().min(1, "Senha é obrigatória"),
      }),
    },
    handler: authCtrl.login,
  });
  app.get("/", async () => {
    return { status: "Online 🚀" };
  });

  // --- ROTAS PROTEGIDAS (Precisa de Token) ---
  app.register(async (protectedRoutes) => {
    // Adiciona o middleware em todas as rotas dentro deste bloco
    protectedRoutes.addHook("preHandler", authMiddleware);

    // Usuário
    protectedRoutes.get("/me", (req, rep) => authCtrl.me(req, rep));

    // Biblioteca
    protectedRoutes.get("/series", (req, rep) =>
      libraryCtrl.listSeries(req, rep),
    );
    protectedRoutes.get("/series/:id", (req, rep) =>
      libraryCtrl.getSeriesDetails(req, rep),
    );

    // Leitura
    protectedRoutes.get("/read/:id/info", (req, rep) =>
      readerCtrl.getChapterInfo(req, rep),
    );
    protectedRoutes.get("/read/:id/page/:page", (req, rep) =>
      readerCtrl.getPage(req, rep),
    );
    protectedRoutes.post(
      "/read/:id/progress",
      {
        schema: {
          body: z.object({
            page: z.number().int().nonnegative(),
          }),
        },
      },
      (req, rep) => readerCtrl.updateProgress(req, rep),
    );

    // Administração (Upload e Scan)
    protectedRoutes.post("/upload", (req, rep) =>
      uploadCtrl.uploadFile(req, rep),
    );
    protectedRoutes.post("/upload/bulk", (req, rep) =>
      uploadCtrl.uploadBulk(req, rep),
    );

    protectedRoutes.post(
      "/scan",
      {
        schema: {
          body: z.object({
            path: z.string().min(1, "Caminho é obrigatório"),
          }),
        },
      },
      async (req, reply) => {
        const { path } = req.body as { path: string };
        scannerSvc.scanLibrary(path);
        return { message: "Scan iniciado." };
      },
    );
  });
}
