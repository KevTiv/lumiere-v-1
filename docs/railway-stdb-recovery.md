# Railway SpacetimeDB backup and recovery

Lumiere's Railway `production` environment runs SpacetimeDB Standalone 2.8.2
as `spacetimedb` with `spacetimedb-data-eu` mounted at `/data`. Provision the
following backup and recovery resources in the existing Railway project.

| Resource | Purpose |
| --- | --- |
| `production` / `spacetimedb` | Live database, with daily Railway volume backups for same-environment recovery |
| `production` / `spacetimedb-backups` | Private Amsterdam bucket dedicated to portable backup archives and manifests |
| `recovery` / `spacetimedb-recovery` | On-demand recovery target with a separate `/data` volume and fresh drill directories |

[Railway volume backups](https://docs.railway.com/volumes/backups) are
crash-consistent and restoring one stages a volume swap on the original
service. Use the portable archive for isolated drills. The existing
[`backup-stdb.sh`](../scripts/backup-stdb.sh) tenant export remains useful for
inspecting application data. See [organization reconstruction](organization-reconstruction.md)
for the separate PostgreSQL projection recovery path.

## Provision and verify

1. Check free space on the production volume. Live-resize `spacetimedb-data-eu`
   in the Railway volume settings before the first production backup if it is
   near capacity. A 20 GB starting size leaves headroom for growth and Railway's
   manual backup limit of 50% of volume capacity. Check the plan's size limit
   before choosing the size. Enable daily volume backups and take a manual
   snapshot after the resize. [Railway live resize](https://docs.railway.com/volumes#live-resizing-the-volume)
2. Verify the private `spacetimedb-backups` bucket in `production`. Use its
   generated S3 bucket name, endpoint, region, and credentials in a dedicated
   `rclone` S3 remote on the source. Use an `age` public recipient for capture
   and keep its private identity in the recovery secret store. Keep bucket
   credentials scoped to the backup workflow. [Railway storage buckets](https://docs.railway.com/storage-buckets)
3. Create an **empty** `recovery` environment from the Railway dashboard or with
   `railway environment new recovery` from the linked project. Create
   `spacetimedb-recovery` from the same digest-pinned image with its own
   volume sized for the encrypted input, unpacked data, and replay overhead.
   Configure `sleep infinity` as its Railway Start Command during setup so the
   volume is available over SSH before a database starts. Keep the target
   private and use recovery-only configuration. Give the recovery workflow
   access to the selected objects using short-lived GET links or an operator
   transfer. Railway creates separate bucket instances per environment.
   [Railway environments](https://docs.railway.com/environments) ·
   [Start command override](https://docs.railway.com/deployments/start-command)

Set these service variables for the bucket remote using Railway variable
references. Newly provisioned Railway buckets use virtual-hosted URLs. Use the
URL style shown in the bucket credentials and keep the normal rclone upload
integrity checks enabled. [Railway bucket URL styles](https://docs.railway.com/storage-buckets#url-style)

```text
RCLONE_CONFIG_BACKUP_TYPE=s3
RCLONE_CONFIG_BACKUP_PROVIDER=Other
RCLONE_CONFIG_BACKUP_ENDPOINT=${{spacetimedb-backups.ENDPOINT}}
RCLONE_CONFIG_BACKUP_REGION=${{spacetimedb-backups.REGION}}
RCLONE_CONFIG_BACKUP_ACCESS_KEY_ID=${{spacetimedb-backups.ACCESS_KEY_ID}}
RCLONE_CONFIG_BACKUP_SECRET_ACCESS_KEY=${{spacetimedb-backups.SECRET_ACCESS_KEY}}
RCLONE_CONFIG_BACKUP_FORCE_PATH_STYLE=false
RCLONE_CONFIG_BACKUP_NO_CHECK_BUCKET=true
STDB_BACKUP_DESTINATION=backup:${{spacetimedb-backups.BUCKET}}/production
```

## Capture a portable backup

Build and publish the opt-in source image from
[`Dockerfile.spacetimedb-recovery`](../Dockerfile.spacetimedb-recovery) to a
registry accessible to the source and recovery environments. Rehearse that
exact image digest on a disposable deployment with synthetic data. The existing
production entrypoint hands control to the database process, so stopping that
process normally stops the deployment and makes its mount inaccessible. The
backup supervisor keeps the mount available, waits for a clean engine shutdown,
and restarts the engine when the capture completes, fails, or times out.

Use an operator maintenance window and keep releases and module publishing out
of that window. Record the exact digest-pinned server image, the active module
revision, and the projection watermarks. Configure the capture with
`STDB_DATA_DIR=/data`, `STDB_BACKUP_DESTINATION=backup:<bucket>/production`,
`STDB_BACKUP_AGE_RECIPIENT`, and `STDB_BACKUP_IMAGE`. Set the latter to the
exact registry image digest used by the source. Set `STDB_BACKUP_MAX_SECONDS`
to a tested capture deadline. Its default is 300 seconds. Once the disposable
capture and restore drills pass, roll out the backup-capable source image by
digest during the maintenance window.

From the linked project, request a capture through the root-only operator
command. Set `module_revision` to the full Git SHA from the successful publisher
release for the active module. Track completion in the production service logs.

```bash
railway ssh --environment production --service spacetimedb -- \
  "python3 /usr/local/lib/lumiere/railway-stdb-supervisor.py request $module_revision"
```

The supervisor invokes [`railway-stdb-backup.sh`](../scripts/railway-stdb-backup.sh)
with a unique backup ID while the database is stopped. The capture keeps the
database lock for the duration and streams the encrypted archive off the source
volume. Under the configured destination, expect these two objects:

```text
physical/<backup-id>/data.tar.gz.age
physical/<backup-id>/manifest.json
```

Use the manifest as the completion record. Capture hashes the uploaded
ciphertext again before publishing the manifest, so budget for the transfer
and readback inside the maintenance window. After the attempt, confirm the
database and application `/ready` endpoint are healthy and projection catches up.
Retry with a new backup ID if the previous attempt left a partial upload.

## Restore drill

Fetch the archive and matching manifest to a private recovery workspace. Use a
fresh directory such as `/data/restore-<backup-id>` on the recovery volume.
Retrieve the `age` identity from the recovery secret store into a protected
temporary file. The restoration command requires Python 3.11 or newer and
`age`. It checks the expected image reference and archive integrity before
extraction. On Railway, run it only in `recovery` / `spacetimedb-recovery`,
where the image includes it at `/usr/local/lib/lumiere/railway-stdb-restore.py`.
Start the database separately after checking the target image digest. The
restore omits production signing keys and the process lock.

```bash
STDB_RECOVERY_ISOLATED=1 \
STDB_RECOVERY_IMAGE='registry/image@sha256:<recorded-digest>' \
  python3 scripts/railway-stdb-restore.py \
    /secure/input/manifest.json /secure/input/data.tar.gz.age \
    /secure/age-identity /data/restore-<backup-id>
```

Use the hosted recovery service for synthetic fixtures until database process
egress isolation is independently verified. Railway's private networks separate
environments, while services still have outbound IPv4 internet access. The
archived database can contain scheduled reducers that run during startup and
replay. For a production archive,
start the pinned engine in a network-disabled recovery runtime, such as Docker
with `--network none`, and run probes from inside that runtime. Use recovery
signing keys and test identities. [Railway outbound isolation guidance](https://station.railway.com/questions/technical-inquiry-network-isolation-fo-09930e2a)

Check that the module boots, sample records match the backup point, authorized
reads succeed, and a different tenant cannot read those records. Compare the
restored commit sequence with the matching PostgreSQL projection recovery point
and verify the archive transfer ledger before considering any production
cutover. Record the backup ID, image digest, module revision, elapsed restore
time, and confirmed recovery point. Remove plaintext drill data after the
evidence is recorded. [Lumiere operations runbook](C11_OPERATIONS_RUNBOOK.md)

Keep capture manual until a complete round trip and a failed capture both prove
that the source returns to service within the maintenance window. Then choose
the export cadence from the measured outage and recovery points. Monitor disk
usage and age of the last verified backup. Apply bucket expiry through a
separate retention procedure and preserve the latest verified recovery point.
Keep live transaction segments on `/data`. [Backup and recovery policy](plans/backup-recovery-followup.md)
