import Foundation
import LampKit

/// 每台灯各自的发包地址。
///
/// 发包目标必须和控制台选中的灯是同一台。以前它是一个全局地址，与设备簿毫无
/// 关联：控制台连着 A，UDP 却发去 B，而界面上没有任何迹象 —— 2026-11-03 实测
/// 踩到的正是这个。灯的音源模式明明已经是 LAMP1，却因为包发往一台早已不在的
/// 地址而只收到空帧（LAMP1 断流不回落本地麦克风，于是读数一片全 0）。
///
/// 默认什么都不存：没有专门指定过的灯，发包地址就是它在设备簿里的地址，所以
/// 新加一台灯天然就是「发给它自己」。只有板子的音频口与控制口不在同一地址时
/// 才需要记一条覆盖。
///
/// 地址本身不缓存，每次都从设备簿现查 —— 灯换了 IP（DHCP 续租、mDNS 重新
/// 发现）发包才跟得上。
enum SendTargets {
    /// 设备 id → 专门指定的发包地址。只存被改过的那几台。
    private static let overridesKey = "sendTargetOverrides"
    /// 控制台当前选中的灯。控制台是唯一能改选中项的地方，但发包线程在控制台
    /// 没打开时也得知道发给谁，所以单独记一份 id。
    private static let deviceKey = "sendTargetDeviceID"
    /// 还没选过灯时的地址。沿用旧键名，老配置不丢。
    static let fallbackKey = "targetSpec"

    /// 当前的发包对象。`spec` 是真正要发往的地址，其余是给界面显示用的。
    struct Resolved: Equatable {
        var deviceID: String? = nil
        var deviceName: String? = nil
        /// 灯自己的地址，作为「发包地址」输入框的 placeholder。
        var deviceHost: String? = nil
        var spec: String
        /// 发包地址是专门指定的，不等于灯自己的地址。
        var isOverridden: Bool { deviceID != nil && deviceHost != spec }
    }

    // MARK: - 读

    static func overrides(_ defaults: UserDefaults = .standard) -> [String: String] {
        defaults.dictionary(forKey: overridesKey) as? [String: String] ?? [:]
    }

    /// 专门指定的地址。空白与「就用灯自己的地址」等价，一律当没指定。
    static func override(for id: String, _ defaults: UserDefaults = .standard) -> String? {
        let s = overrides(defaults)[id]?.trimmingCharacters(in: .whitespacesAndNewlines)
        return (s?.isEmpty ?? true) ? nil : s
    }

    /// 还没在控制台里绑定过（新装、或控制台从没打开）时，退回 LampKit 记的上次选中项 ——
    /// 否则开机自启的发包线程会一直用兜底地址，直到有人打开控制台。
    static func deviceID(_ defaults: UserDefaults = .standard) -> String? {
        defaults.string(forKey: deviceKey) ?? defaults.string(forKey: "LampKit.selectedDevice")
    }

    /// 默认值不该指向某一台具体的灯 —— 这是个公开仓库，别人 clone 下来不该默认
    /// 往作者的设备发包。wled.local 是 WLED 的通用名；解析不到就退回组播，同网段
    /// 照样送得到。
    static func fallback(_ defaults: UserDefaults = .standard) -> String {
        defaults.string(forKey: fallbackKey) ?? "wled.local"
    }

    /// 现在该往哪儿发。没选灯、或选中的灯已经从设备簿里删掉了，就用兜底地址。
    static func current(_ defaults: UserDefaults = .standard) -> Resolved {
        guard let id = deviceID(defaults),
              let d = DeviceBook.loadPersisted(from: defaults).devices.first(where: { $0.id == id })
        else { return Resolved(spec: fallback(defaults)) }
        return Resolved(deviceID: d.id, deviceName: d.name, deviceHost: d.host,
                        spec: override(for: d.id, defaults) ?? d.host)
    }

    // MARK: - 写

    static func setDeviceID(_ id: String?, _ defaults: UserDefaults = .standard) {
        if let id { defaults.set(id, forKey: deviceKey) }
        else { defaults.removeObject(forKey: deviceKey) }
    }

    /// 针对一台灯指定发包地址。传 nil 或空白即恢复「发给灯自己」。
    static func setOverride(_ spec: String?, for id: String, _ defaults: UserDefaults = .standard) {
        var all = overrides(defaults)
        let s = spec?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if s.isEmpty { all.removeValue(forKey: id) } else { all[id] = s }
        defaults.set(all, forKey: overridesKey)
    }

    /// 灯删掉之后把它的覆盖项一并清掉，免得攒一堆指向不存在设备的地址。
    static func prune(keeping ids: Set<String>, _ defaults: UserDefaults = .standard) {
        let all = overrides(defaults)
        let kept = all.filter { ids.contains($0.key) }
        if kept.count != all.count { defaults.set(kept, forKey: overridesKey) }
    }
}
