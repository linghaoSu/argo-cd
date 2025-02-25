# Redis HA Manifests

The Redis HA manifests are taken from the upstream helm chart, and tweaked slightly to add
Argo CD labels.  We also add roles to redis-ha service accounts to enable run-as non-root users
in OpenShift.
* `chart` is a helm chart that references the upstream redis-ha chart. To update redis, update the
  version in `chart/requirements.yaml` with a later version of the chart.
* `overlays` is a directory containing kustomize overlays for Argo CD, namely label modifications and
  role additions.
* `generate.sh` is a script to regenerate the final kustomize 

## Automated Updates

The Redis HA chart is automatically updated using Renovate. When a new chart version is released:

1. Renovate will detect the update and create a PR to bump the version in `chart/requirements.yaml`
2. After updating the version, Renovate will automatically run:
   - `./generate.sh` to regenerate the `chart/upstream.yaml` file
   - `make manifests-local` to update all necessary manifests

This ensures that all dependent files are kept in sync with the chart version.

To manually update the Redis HA chart:

1. Update the version in `manifests/ha/base/redis-ha/chart/requirements.yaml`
2. Run `cd manifests/ha/base/redis-ha && ./generate.sh`
3. Run `make manifests-local` from the root of the repository 
