package expo.modules.googlecredential

import androidx.credentials.ClearCredentialStateRequest
import androidx.credentials.CredentialManager
import androidx.credentials.CustomCredential
import androidx.credentials.GetCredentialRequest
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.GetCredentialException
import androidx.credentials.exceptions.NoCredentialException
import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import com.google.android.libraries.identity.googleid.GoogleIdTokenParsingException
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Minimal "Sign in with Google" via Jetpack Credential Manager.
 * Returns only the Google ID token; Supabase verifies it server-side.
 */
class GoogleCredentialModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("GoogleCredential")

    AsyncFunction("signIn") Coroutine { webClientId: String, hashedNonce: String ->
      val activity = appContext.currentActivity
        ?: throw CodedException("NO_ACTIVITY", "No foreground activity to show the Google sheet", null)

      // Branded chooser: always available behind an explicit button (no one-tap cooldown).
      val option = GetSignInWithGoogleOption.Builder(webClientId)
        .setNonce(hashedNonce)
        .build()
      val request = GetCredentialRequest.Builder()
        .addCredentialOption(option)
        .build()

      val result = try {
        CredentialManager.create(activity).getCredential(activity, request)
      } catch (e: GetCredentialCancellationException) {
        throw CodedException("SIGN_IN_CANCELLED", "User dismissed Google sign-in", e)
      } catch (e: NoCredentialException) {
        throw CodedException("NO_GOOGLE_ACCOUNT", "No Google account available on this device", e)
      } catch (e: GetCredentialException) {
        throw CodedException("SIGN_IN_FAILED", "${e.type}: ${e.message}", e)
      }

      val credential = result.credential
      if (credential !is CustomCredential ||
        credential.type != GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL
      ) {
        throw CodedException("UNEXPECTED_CREDENTIAL", "Unexpected credential type: ${credential.type}", null)
      }

      try {
        GoogleIdTokenCredential.createFrom(credential.data).idToken
      } catch (e: GoogleIdTokenParsingException) {
        throw CodedException("UNEXPECTED_CREDENTIAL", "Could not parse the Google ID token", e)
      }
    }

    // Forget the selected account so the next sign-in shows the chooser again. Best effort.
    AsyncFunction("signOut") Coroutine { ->
      appContext.reactContext?.let { context ->
        runCatching {
          CredentialManager.create(context).clearCredentialState(ClearCredentialStateRequest())
        }
      }
      Unit
    }
  }
}