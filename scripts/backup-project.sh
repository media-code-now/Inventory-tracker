#!/bin/sh
# Trusted owner workstation with Supabase CLI linked to the intended production project.
set -eu
umask 077
: "${STOCKROOM_BACKUP_PROJECT_REF:?Set the exact expected project reference}"
BACKUP_DESTINATION=${1:?Pass a new backup directory outside source control}
LINKED_REF=$(cat supabase/.temp/project-ref)
[ "$LINKED_REF" = "$STOCKROOM_BACKUP_PROJECT_REF" ] || { echo 'Refusing backup: linked project differs from expected project' >&2; exit 1; }
[ ! -e "$BACKUP_DESTINATION" ] || { echo 'Choose a new backup directory; existing backups are never overwritten' >&2; exit 1; }
mkdir -p "$BACKUP_DESTINATION"
# A failed job retains INCOMPLETE so it cannot be mistaken for a complete backup.
touch "$BACKUP_DESTINATION/INCOMPLETE"
supabase db dump --linked --role-only --file "$BACKUP_DESTINATION/roles.sql"
supabase db dump --linked --file "$BACKUP_DESTINATION/schema.sql"
supabase db dump --linked --data-only --use-copy --exclude 'storage.buckets_vectors,storage.vector_indexes' --file "$BACKUP_DESTINATION/data.sql"
supabase db dump --linked --schema supabase_migrations --file "$BACKUP_DESTINATION/history-schema.sql"
supabase db dump --linked --schema supabase_migrations --data-only --use-copy --file "$BACKUP_DESTINATION/history-data.sql"
# App-private Storage policies are customizations of a managed schema; capture them separately.
supabase db diff --linked --schema auth,storage > "$BACKUP_DESTINATION/managed-customizations.sql"
(cd "$BACKUP_DESTINATION" && shasum -a 256 ./*.sql > SHA256SUMS)
printf '%s\n' "$LINKED_REF" > "$BACKUP_DESTINATION/project-ref.txt"
# Keep warning in the backup itself: this helper does not back up Storage bytes or service settings.
printf '%s\n' 'Database-only backup. Storage object bytes, Auth/SMTP settings, Edge Function secrets, and deployment configuration require separate backup. Follow OPERATIONS.md and complete a restore drill.' > "$BACKUP_DESTINATION/README.txt"
rm "$BACKUP_DESTINATION/INCOMPLETE"
echo 'Database backup completed. Encrypt it, copy it offsite, back up item-image bytes, and test restoration.'
