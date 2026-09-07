/**
 * Runtime config for the Apps Script project.
 *
 * Secrets and IDs live in Project Settings → Script properties, NOT in source.
 * See backend/SCRIPT_PROPERTIES.example and SECURITY.md.
 *
 * Empty expected secrets never match. That way a missing property cannot
 * accidentally authorize a request that also omitted the secret.
 */

function scriptProp_(key) {
  var v = PropertiesService.getScriptProperties().getProperty(key);
  if (v == null) return '';
  return String(v);
}

function requireScriptProp_(key) {
  var v = scriptProp_(key);
  if (!v) {
    throw new Error(
      'Missing Apps Script property "' + key + '". Set it under Project Settings → Script properties.'
    );
  }
  return v;
}

function secretsMatch_(expected, provided) {
  return !!(expected && provided && String(expected) === String(provided));
}
