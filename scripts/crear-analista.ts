// Crea (o actualiza) un usuario del panel de analistas.
// Uso: npx tsx scripts/crear-analista.ts <email> <contraseña> "<nombre>" [analista|supervisor]
import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";

const [email, password, nombre, rol = "analista"] = process.argv.slice(2);
if (!email || !password || !nombre) {
  console.error('Uso: npx tsx scripts/crear-analista.ts <email> <contraseña> "<nombre>" [analista|supervisor]');
  process.exit(1);
}
if (password.length < 12) {
  console.error("La contraseña debe tener al menos 12 caracteres.");
  process.exit(1);
}

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

async function main() {
  const { data: lista } = await admin.auth.admin.listUsers();
  let user = lista.users.find((u) => u.email === email);
  if (user) {
    await admin.auth.admin.updateUserById(user.id, { password });
  } else {
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (error) throw error;
    user = data.user;
  }
  const { error } = await admin.from("analistas").upsert({ user_id: user!.id, email, nombre, rol, activo: true });
  if (error) throw error;
  console.log(`Analista listo: ${email} (${rol})`);
}

main().catch((e) => { console.error(e); process.exit(1); });
