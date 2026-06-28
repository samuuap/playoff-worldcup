# Quiniela Mundial ⚽

App de pronósticos para la fase eliminatoria: cada usuario predice el **cuadro completo** desde el inicio (toca una bandera y avanza a la ronda siguiente), y **cada partido se cierra a su hora** (`kickoff_at`). Puntuación escalada por ronda (1 / 2 / 4 / 8 / 16) y clasificación en vivo.

Stack: **Next.js (App Router)** + **Supabase** (Postgres, Auth, RLS). Sin servidor propio.

---

## 1. Crear la base de datos

1. Crea un proyecto en [supabase.com](https://supabase.com).
2. Ve a **SQL Editor → New query**, pega todo `supabase/schema.sql` y ejecútalo.
   - Crea las tablas (`profiles`, `matches`, `picks`), el RLS (incluido el **cierre por `kickoff_at` blindado en la base de datos**), la función `leaderboard()` y carga tu árbol de 32 equipos.
3. (Recomendado para amigos) **Authentication → Providers → Email**: desactiva *Confirm email* para que puedan entrar sin verificar el correo.

## 2. Configurar la app

```bash
cp .env.local.example .env.local
```

Rellena con los datos de **Project Settings → API**:

```
NEXT_PUBLIC_SUPABASE_URL=https://TU-PROYECTO.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=tu-anon-public-key
```

## 3. Ejecutar en local

```bash
npm install
npm run dev
```

Abre http://localhost:3000

## 4. Hacerte administrador

Regístrate una vez en la app. Luego, en el SQL Editor:

```sql
update public.profiles set is_admin = true
where id = (select id from auth.users where email = 'TU_EMAIL@ejemplo.com');
```

Recarga y verás la pestaña **Admin**.

## 5. Operar la quiniela

En **Admin** puedes, por partido:
- **Hora de cierre** (`kickoff_at`): a partir de ahí ya no se puede pronosticar ese partido.
- **Puntos**: pon **0** para que un partido **no compute** para nadie.
- **Resultado**: al fijarlo, la clasificación se recalcula sola. Los rivales de cada ronda aparecen en el desplegable a medida que fijas los ganadores de la ronda anterior.

**Cierre único (deadline global):** arriba del panel tienes "Cierre único para TODOS los partidos". Pones una fecha/hora y "Aplicar a todos" deja todo el cuadro con el mismo cierre. Es el modelo recomendado para una quiniela de amigos: cada uno rellena el cuadro entero y todo se congela a esa hora.

> Caso "esta noche a las 21:00": deja ese único partido con su `kickoff_at` a las 21:00. Es el único que se cierra hoy; el resto del cuadro sigue abierto. Si no llegas a tiempo, simplemente nadie lo habrá marcado y dará 0 a todos. Si además quieres asegurarte de que no cuente, ponle **0 puntos**.

## 6. Desplegar (Vercel)

1. Sube el repo a GitHub.
2. Impórtalo en [vercel.com](https://vercel.com).
3. Añade las dos variables `NEXT_PUBLIC_SUPABASE_…` en el proyecto de Vercel.
4. En Supabase → **Authentication → URL Configuration**, añade tu dominio de Vercel a *Site URL* / *Redirect URLs*.

---

### Notas
- Las banderas se cargan desde `flagcdn.com` por código de país (mapa en `lib/bracket.js`). Si una falla, muestra las iniciales del país.
- Para cambiar equipos del cuadro, edita el `INSERT` de R32 en `supabase/schema.sql` (y, si añades países nuevos, su código en `ISO` dentro de `lib/bracket.js`).
- El modelo: cada predicción se compara con quién ganó **realmente esa posición del cuadro**; aciertas si tu equipo es el que avanzó de verdad.
