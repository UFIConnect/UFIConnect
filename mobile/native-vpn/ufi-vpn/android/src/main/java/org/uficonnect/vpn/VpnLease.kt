package org.uficonnect.vpn

import com.wireguard.config.Config
import com.wireguard.config.InetNetwork
import com.wireguard.crypto.Key
import com.wireguard.crypto.KeyPair
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.net.InetAddress
import java.time.Instant

internal class VpnLease(val json: JSONObject, privateKey: Key) {
  val id: String = json.getString("deviceId")
  val gateway: String = json.getString("gatewayId")
  val publicKey: String = json.getString("publicKey")
  val expires: Long = Instant.parse(json.getString("leaseExpiresAt")).toEpochMilli()
  val config: Config
  private fun list(name: String): List<String> = json.getJSONArray(name).let { array -> (0 until array.length()).map { array.getString(it) } }
  init {
    require(id.matches(Regex("[A-Za-z0-9_-]{1,128}")) && gateway.matches(Regex("[A-Za-z0-9_-]{1,128}")))
    require(publicKey == KeyPair(privateKey).publicKey.toBase64())
    Key.fromBase64(json.getString("serverPublicKey"))
    val addresses = list("addresses"); val routes = list("allowedIPs"); val dns = list("dns")
    require(addresses.size == 2 && addresses.any { it.endsWith("/32") && InetNetwork.parse(it).address.address.size == 4 } && addresses.any { it.endsWith("/128") && InetNetwork.parse(it).address.address.size == 16 })
    require(routes.size == 2 && routes.toSet() == setOf("0.0.0.0/0", "::/0"))
    require(dns.isNotEmpty() && dns.all { it.matches(Regex("[a-fA-F0-9:.]+")) && InetAddress.getByName(it).address.size in listOf(4,16) })
    require(json.getString("endpoint").matches(Regex("(?:[A-Za-z0-9.-]+|\\[[a-fA-F0-9:]+\\]):[0-9]{1,5}")))
    require(json.getString("endpoint").substringAfterLast(':').toInt() in 1..65535)
    require(json.getInt("persistentKeepalive") == 25 && json.getString("ipv6Egress") == "blocked")
    require(expires - System.currentTimeMillis() in 1..360000)
    // Configuration is constructed natively and never returned to JavaScript or logs.
    val text = "[Interface]\nPrivateKey = ${privateKey.toBase64()}\nAddress = ${addresses.joinToString(", ")}\nDNS = ${dns.joinToString(", ")}\nMTU = 1280\n[Peer]\nPublicKey = ${json.getString("serverPublicKey")}\nEndpoint = ${json.getString("endpoint")}\nAllowedIPs = 0.0.0.0/0, ::/0\nPersistentKeepalive = 25\n"
    config = Config.parse(ByteArrayInputStream(text.toByteArray(Charsets.UTF_8)))
  }
}
