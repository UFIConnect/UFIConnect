package org.uficonnect.vpn

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.AtomicFile
import java.io.File
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import org.json.JSONObject

// AES wrapping key is non-exportable in Android Keystore. Ciphertext is excluded from backup.
internal object VpnSecrets {
  private const val ALIAS = "org.uficonnect.vpn.device"
  private fun key(): SecretKey {
    val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    (store.getKey(ALIAS, null) as? SecretKey)?.let { return it }
    return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
      init(KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
        .setRandomizedEncryptionRequired(true).build())
    }.generateKey()
  }
  private fun file(context: Context) = AtomicFile(File(context.noBackupFilesDir, "ufi-vpn.enc"))
  @Synchronized fun read(context: Context): JSONObject {
    val file = file(context)
    if (!file.baseFile.exists()) return JSONObject()
    val bytes = file.readFully()
    check(bytes.size in 29..131072) { "Secure VPN storage is unavailable" }
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, bytes.copyOfRange(0, 12)))
    return JSONObject(String(cipher.doFinal(bytes.copyOfRange(12, bytes.size)), Charsets.UTF_8))
  }
  @Synchronized fun write(context: Context, value: JSONObject) {
    val cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.ENCRYPT_MODE, key())
    val bytes = cipher.iv + cipher.doFinal(value.toString().toByteArray(Charsets.UTF_8))
    val file = file(context); val stream = file.startWrite()
    try { stream.write(bytes); file.finishWrite(stream) } catch (error: Exception) { file.failWrite(stream); throw error }
  }
  @Synchronized fun clear(context: Context) { file(context).delete() }
}
