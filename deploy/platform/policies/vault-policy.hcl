# K-Admission Vault policy examples
# Paths are illustrative. Public-sector deployment must separately satisfy
# institution-specific crypto-module and KCMVP requirements where applicable.

# Admission API: university-local application secrets only
path "kv/data/universities/UNIV-A/apps/admission" {
  capabilities = ["read"]
}
path "kv/metadata/universities/UNIV-A/apps/admission" {
  capabilities = ["read"]
}

# Dynamic DB credentials
path "database/creds/admission-api-UNIV-A" {
  capabilities = ["read"]
}

# Service mTLS certificate issuance
path "pki/issue/kadmission-univ-a-service" {
  capabilities = ["create", "update"]
}

# Central sync client credentials for event-relay only
path "kv/data/universities/UNIV-A/apps/event-relay" {
  capabilities = ["read"]
}

# Optional transit encryption interface
# Do not treat Vault transit as automatically satisfying KCMVP.
path "transit/encrypt/pii-UNIV-A" {
  capabilities = ["update"]
}
path "transit/decrypt/pii-UNIV-A" {
  capabilities = ["update"]
}

# Explicit denials for cross-university paths
path "kv/data/universities/+/apps/*" {
  capabilities = ["deny"]
}
path "database/creds/*" {
  capabilities = ["deny"]
}
