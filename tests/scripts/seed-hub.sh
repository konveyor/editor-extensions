#!/bin/bash

set -e  # Exit on error

# Configuration
HUB_URL="${HUB_URL:-https://192.168.49.2}"
USERNAME="${USERNAME:-admin}" # notsecret
PASSWORD="${PASSWORD:-Passw0rd!}" # notsecret

echo "=== Seeding Konveyor Hub at ${HUB_URL} ==="

# Authenticate and get token
echo "Authenticating..."
AUTH_RESPONSE=$(curl -k -s -X POST \
  "${HUB_URL}/hub/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"user\": \"${USERNAME}\", \"password\": \"${PASSWORD}\"}")

TOKEN=$(echo "$AUTH_RESPONSE" | jq -r '.token // empty')

if [ -z "$TOKEN" ]; then
  echo "ERROR: Failed to authenticate"
  echo "Response: $AUTH_RESPONSE"
  exit 1
fi

echo "✓ Authentication successful"

# 1. Get or Create Analysis Profile "Coolstore"
echo ""
echo "Getting or creating Analysis Profile 'Coolstore'..."

# First try to get existing profile
ALL_PROFILES=$(curl -k -s -X GET \
  "${HUB_URL}/hub/analysis/profiles" \
  -H "Authorization: Bearer ${TOKEN}")

ANALYSIS_PROFILE_ID=$(echo "$ALL_PROFILES" | jq -r '.[] | select(.name=="Coolstore") | .id // empty' | head -n 1)

if [ -n "$ANALYSIS_PROFILE_ID" ]; then
  echo "✓ Analysis Profile already exists with ID: $ANALYSIS_PROFILE_ID"
else
  # Create new profile
  ANALYSIS_PROFILE_RESPONSE=$(curl -k -s -X POST \
    "${HUB_URL}/hub/analysis/profiles" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${TOKEN}" \
    -d '{
      "name": "Coolstore",
      "mode": {
        "withDeps": true
      },
      "scope": {
        "withKnownLibs": false,
        "packages": {
          "included": [],
          "excluded": []
        }
      },
      "rules": {
        "targets": [
          {"id": 2},
          {"id": 5},
          {"id": 9}
        ],
        "labels": {
          "included": [],
          "excluded": []
        }
      }
    }')

  ANALYSIS_PROFILE_ID=$(echo "$ANALYSIS_PROFILE_RESPONSE" | jq -r '.id // empty')

  if [ -z "$ANALYSIS_PROFILE_ID" ]; then
    echo "ERROR: Failed to create Analysis Profile"
    echo "Response: $ANALYSIS_PROFILE_RESPONSE"
    exit 1
  fi

  echo "✓ Analysis Profile created with ID: $ANALYSIS_PROFILE_ID"
fi

# 2. Get or Create Archetype "coolstore"
echo ""
echo "Getting or creating Archetype 'coolstore'..."

# First try to get existing archetype
ALL_ARCHETYPES=$(curl -k -s -X GET \
  "${HUB_URL}/hub/archetypes" \
  -H "Authorization: Bearer ${TOKEN}")

ARCHETYPE_ID=$(echo "$ALL_ARCHETYPES" | jq -r '.[] | select(.name=="coolstore") | .id // empty' | head -n 1)

if [ -n "$ARCHETYPE_ID" ]; then
  echo "✓ Archetype already exists with ID: $ARCHETYPE_ID"
else
  # Create new archetype
  ARCHETYPE_RESPONSE=$(curl -k -s -X POST \
    "${HUB_URL}/hub/archetypes" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${TOKEN}" \
    -d '{
      "name": "coolstore",
      "description": "",
      "comments": "",
      "criteria": [
        {
          "id": 404,
          "name": "Java"
        }
      ],
      "tags": [],
      "stakeholders": [],
      "stakeholderGroups": []
    }')

  ARCHETYPE_ID=$(echo "$ARCHETYPE_RESPONSE" | jq -r '.id // empty')

  if [ -z "$ARCHETYPE_ID" ]; then
    echo "ERROR: Failed to create Archetype"
    echo "Response: $ARCHETYPE_RESPONSE"
    exit 1
  fi

  echo "✓ Archetype created with ID: $ARCHETYPE_ID"
fi

# 3. Get current archetype state to check if profile is already assigned
echo ""
echo "Checking if Archetype already has Analysis Profile..."
CURRENT_ARCHETYPE=$(curl -k -s -X GET \
  "${HUB_URL}/hub/archetypes/${ARCHETYPE_ID}" \
  -H "Authorization: Bearer ${TOKEN}")

# Check if the archetype already has the Coolstore analysis profile
HAS_PROFILE=$(echo "$CURRENT_ARCHETYPE" | jq -r '.profiles[]? | select(.analysisProfile.id == '${ANALYSIS_PROFILE_ID}') | .analysisProfile.id // empty')

if [ -n "$HAS_PROFILE" ]; then
  echo "✓ Archetype already has the Coolstore Analysis Profile"
else
  # 4. Update Archetype with Analysis Profile
  echo ""
  echo "Updating Archetype with Analysis Profile..."

  # Extract criteria from current archetype (default to empty array if null)
  CRITERIA=$(echo "$CURRENT_ARCHETYPE" | jq '.criteria // []')

  echo "DEBUG: Current criteria: $CRITERIA"
  echo "DEBUG: Analysis Profile ID: $ANALYSIS_PROFILE_ID"

  # Build the payload using jq to ensure valid JSON
  PAYLOAD=$(jq -n \
    --argjson criteria "$CRITERIA" \
    --arg name "coolstore" \
    --argjson profileId "$ANALYSIS_PROFILE_ID" \
    '{
      name: $name,
      description: "",
      comments: "",
      tags: [],
      criteria: $criteria,
      stakeholders: [],
      stakeholderGroups: [],
      profiles: [
        {
          name: "coolstore",
          analysisProfile: {
            id: ($profileId | tonumber)
          }
        }
      ]
    }')

  echo "DEBUG: Payload to send:"
  echo "$PAYLOAD" | jq .

  ARCHETYPE_UPDATE_RESPONSE=$(curl -k -s -w "\nHTTP_STATUS:%{http_code}" -X PUT \
    "${HUB_URL}/hub/archetypes/${ARCHETYPE_ID}" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${TOKEN}" \
    -d "$PAYLOAD")

  HTTP_STATUS=$(echo "$ARCHETYPE_UPDATE_RESPONSE" | grep "HTTP_STATUS:" | cut -d':' -f2)
  RESPONSE_BODY=$(echo "$ARCHETYPE_UPDATE_RESPONSE" | sed '/HTTP_STATUS:/d')

  echo "DEBUG: HTTP Status: $HTTP_STATUS"
  echo "DEBUG: Response Body: $RESPONSE_BODY"

  if [ "$HTTP_STATUS" != "200" ] && [ "$HTTP_STATUS" != "201" ] && [ "$HTTP_STATUS" != "204" ]; then
    echo "ERROR: Failed to update Archetype (HTTP $HTTP_STATUS)"
    echo "Response: $RESPONSE_BODY"
    exit 1
  fi

  echo "✓ Archetype updated with Analysis Profile (HTTP $HTTP_STATUS)"
fi

# 5. Get or Create Application "coolstore"
echo ""
echo "Getting or creating Application 'coolstore'..."

# First try to get existing application
ALL_APPLICATIONS=$(curl -k -s -X GET \
  "${HUB_URL}/hub/applications" \
  -H "Authorization: Bearer ${TOKEN}")

APPLICATION_ID=$(echo "$ALL_APPLICATIONS" | jq -r '.[] | select(.name=="coolstore") | .id // empty' | head -n 1)

if [ -n "$APPLICATION_ID" ]; then
  echo "✓ Application already exists with ID: $APPLICATION_ID"
else
  # Create new application
  APPLICATION_RESPONSE=$(curl -k -s -X POST \
    "${HUB_URL}/hub/applications" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${TOKEN}" \
    -d '{
      "name": "coolstore",
      "description": "",
      "comments": "",
      "tags": [
        {
          "id": 404,
          "name": "Java"
        }
      ],
      "contributors": [],
      "repository": {
        "kind": "git",
        "url": "https://github.com/konveyor-ecosystem/coolstore",
        "branch": "",
        "path": ""
      },
      "migrationWave": null
    }')

  APPLICATION_ID=$(echo "$APPLICATION_RESPONSE" | jq -r '.id // empty')

  if [ -z "$APPLICATION_ID" ]; then
    echo "ERROR: Failed to create Application"
    echo "Response: $APPLICATION_RESPONSE"
    exit 1
  fi

  echo "✓ Application created with ID: $APPLICATION_ID"
fi

echo ""
echo "=== Hub seeding completed successfully ==="
echo "  Analysis Profile ID: $ANALYSIS_PROFILE_ID"
echo "  Archetype ID: $ARCHETYPE_ID"
echo "  Application ID: $APPLICATION_ID"
