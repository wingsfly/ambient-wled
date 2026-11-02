import SwiftUI
import AppKit
import LampKit

/// 打开编辑窗时带进去的起点：index 为 nil 是新建，否则是覆盖第 index 号自定义调色板。
struct PaletteDraft: Identifiable {
    let id = UUID()
    var index: Int?
    var name: String
    var stops: [PaletteStop]

    /// 新建时的默认两个色标（橙 → 蓝），与网页相同。
    static let newStops = [PaletteStop(pos: 0, rgb: [255, 160, 0]), PaletteStop(pos: 255, rgb: [0, 80, 255])]

    /// 「复制为新的」的名字：原名（没有就「自定义 N」）加「 副本」，最多 32 字。
    static func copyName(_ name: String, index: Int?) -> String {
        let t = name.trimmingCharacters(in: .whitespacesAndNewlines)
        let base = t.isEmpty ? index.map { "自定义 \($0)" } ?? "" : t
        return String("\(base) 副本".prefix(ConsolePaletteEditor.maxName))
    }
}

/// 自定义调色板编辑窗（docs/28 §10.3），交互同网页与 iOS：渐变预览、名字、色标列表
/// （位置滑块、取色、删除；首尾位置固定在 0 与 255）、添加色标、从现有调色板开始、保存 / 复制 / 删除。
///
/// 保存与删除都交给 LampViewModel：保存会选用它并重读 info / palx，删除前会把用着它的分段切回默认。
struct ConsolePaletteEditor: View {
    static let maxName = 32

    @EnvironmentObject private var model: LampViewModel
    @Environment(\.dismiss) private var dismiss
    /// 保存成功但有话要说（比如没能选用）时交给外面显示：编辑窗随后就关了。
    let report: (String) -> Void

    @State private var index: Int?
    @State private var name: String
    @State private var rows: [Row]
    @State private var error: String?
    @State private var working = false
    @State private var confirmDelete = false

    /// 色标行带一个本地 id：位置、颜色都会变，不能拿它们当 ForEach 的身份。
    private struct Row: Identifiable {
        let id = UUID()
        var stop: PaletteStop
    }

    init(draft: PaletteDraft, report: @escaping (String) -> Void) {
        self.report = report
        _index = State(initialValue: draft.index)
        _name = State(initialValue: draft.name)
        _rows = State(initialValue: draft.stops.map { Row(stop: $0) })
    }

    private var stops: [PaletteStop] { rows.map(\.stop) }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(index == nil ? "新建调色板" : "编辑调色板").font(.headline)
            RoundedRectangle(cornerRadius: 6)
                .fill(gradient(stops))
                .frame(height: 30)
                .overlay(RoundedRectangle(cornerRadius: 6).stroke(Color.secondary.opacity(0.3), lineWidth: 0.5))
            TextField("名字", text: $name, prompt: Text(index.map { "自定义 \($0)" } ?? "名字（可不填）"))
                .onChange(of: name) { _, n in
                    if n.count > Self.maxName { name = String(n.prefix(Self.maxName)) }
                }

            HStack {
                Text("色标").font(.subheadline.bold())
                Text("\(rows.count) / \(PaletteFile.maxStops)").font(.caption).foregroundStyle(.secondary)
                Spacer()
                fromExisting
                Button("添加色标") { addStop() }
                    .disabled(rows.count >= PaletteFile.maxStops)
            }
            ScrollView {
                VStack(spacing: 6) {
                    ForEach(Array(rows.enumerated()), id: \.element.id) { i, row in
                        stopRow(row, ends: i == 0 || i == rows.count - 1)
                    }
                }
                .padding(.vertical, 2)
            }
            .frame(minHeight: 120, maxHeight: 320)

            if let error {
                Text(error).font(.caption).foregroundStyle(.red)
                    .fixedSize(horizontal: false, vertical: true)
            }

            HStack {
                if index != nil {
                    Button("删除", role: .destructive) { confirmDelete = true }
                    Button("复制为新的") { copyAsNew() }
                }
                Spacer()
                if working { ProgressView().controlSize(.small) }
                Button("取消") { dismiss() }
                    .keyboardShortcut(.cancelAction)
                Button("保存") { Task { await save() } }
                    .keyboardShortcut(.defaultAction)
                    .disabled(model.busy)
            }
        }
        .padding(20)
        .frame(width: 480)
        .disabled(working)
        .interactiveDismissDisabled(working)
        .alert("删除调色板", isPresented: $confirmDelete) {
            Button("删除", role: .destructive) { Task { await delete() } }
            Button("取消", role: .cancel) {}
        } message: {
            Text("删除「\(displayName)」？其他自定义调色板的编号不变。")
        }
    }

    private var displayName: String {
        let t = name.trimmingCharacters(in: .whitespacesAndNewlines)
        return t.isEmpty ? index.map { "自定义 \($0)" } ?? "新调色板" : t
    }

    // ── 色标行 ─────────────────────────────────────────────

    private func stopRow(_ row: Row, ends: Bool) -> some View {
        HStack(spacing: 8) {
            // 首尾位置固定在 0 与 255；中间的夹在相邻色标之间，不越过它们
            Slider(value: posBinding(row.id), in: 0...255)
                .disabled(ends)
            Text("\(row.stop.pos)").font(.caption.monospacedDigit())
                .frame(width: 28, alignment: .trailing)
            ColorPicker("", selection: colorBinding(row.id), supportsOpacity: false)
                .labelsHidden()
            Button { rows.removeAll { $0.id == row.id } } label: {
                Image(systemName: "minus.circle")
            }
            .buttonStyle(.borderless)
            .help("删除色标")
            .disabled(ends || rows.count <= 2)
        }
    }

    private func posBinding(_ id: UUID) -> Binding<Double> {
        Binding(
            get: { Double(rows.first { $0.id == id }?.stop.pos ?? 0) },
            set: { v in
                guard let i = rows.firstIndex(where: { $0.id == id }), i > 0, i < rows.count - 1 else { return }
                let lo = rows[i - 1].stop.pos, hi = rows[i + 1].stop.pos
                rows[i].stop.pos = min(hi, max(lo, Int(v.rounded())))
            })
    }

    private func colorBinding(_ id: UUID) -> Binding<Color> {
        Binding(
            get: { Color(rgb: rows.first { $0.id == id }?.stop.rgb ?? [0, 0, 0]) },
            set: { c in
                guard let i = rows.firstIndex(where: { $0.id == id }) else { return }
                rows[i].stop.rgb = c.rgb
            })
    }

    /// 在最大间隔中点插一个（PaletteFile.insertStop），已有的行保留各自的 id。
    private func addStop() {
        let old = stops
        let new = PaletteFile.insertStop(old)
        guard new.count == old.count + 1 else { return }
        let at = (0..<old.count).first { new[$0] != old[$0] } ?? old.count
        rows.insert(Row(stop: new[at]), at: at)
    }

    // ── 从现有调色板开始 ─────────────────────────────────────

    /// 只列出读到了预览色标的；记号型（c1 / r 等）按主分段当前颜色 / 固定随机色展开。
    private var fromExisting: some View {
        Menu("从现有调色板开始") {
            ForEach(model.paletteChoices.filter { model.palettePreviews[$0.id] != nil }) { p in
                Button { applyPalette(p) } label: {
                    Label { Text(p.title) } icon: { Image(nsImage: swatchImage(p)) }
                }
            }
        }
        .fixedSize()
    }

    private func applyPalette(_ p: PaletteChoice) {
        guard let raw = model.palettePreviews[p.id] else { return }
        let s = LightModes.stopsFromPalette(raw, segColors: model.state?.primary?.col, id: p.id)
        if s.count >= 2 { rows = s.map { Row(stop: $0) } }
    }

    /// 菜单里的色带小图。NSMenu 画不了 SwiftUI 的渐变，只能先画成 NSImage。
    private func swatchImage(_ p: PaletteChoice) -> NSImage {
        let raw = model.palettePreviews[p.id] ?? []
        let s = LightModes.paletteStops(raw, segColors: model.state?.primary?.col, id: p.id).sorted { $0.0 < $1.0 }
        return NSImage(size: NSSize(width: 40, height: 12), flipped: false) { rect in
            let colors = s.map { nscolor($0.1) }
            if colors.count >= 2 {
                var locs = s.map { CGFloat($0.0) }
                NSGradient(colors: colors, atLocations: &locs, colorSpace: .sRGB)?.draw(in: rect, angle: 0)
            } else {
                (colors.first ?? .gray).setFill()
                rect.fill()
            }
            return true
        }
    }

    private func nscolor(_ rgb: [Int]) -> NSColor {
        let c = rgb + [0, 0, 0]
        return NSColor(srgbRed: CGFloat(c[0]) / 255, green: CGFloat(c[1]) / 255, blue: CGFloat(c[2]) / 255, alpha: 1)
    }

    // ── 保存 / 复制 / 删除 ───────────────────────────────────

    private func save() async {
        working = true
        error = nil
        let r = await model.savePalette(stops: stops, name: name, index: index)
        working = false
        guard let r else { dismiss(); return }
        // 「已保存，但没能选用」：文件已经写进去了，留在这里再点保存会多建一个
        if r.hasPrefix("已保存") { report(r); dismiss() } else { error = r }
    }

    /// 把当前色标与名字（加「 副本」）带到新建：不动原来那个。
    private func copyAsNew() {
        name = PaletteDraft.copyName(name, index: index)
        index = nil
        error = nil
    }

    private func delete() async {
        guard let index else { return }
        working = true
        error = nil
        let r = await model.deletePalette(index: index)
        working = false
        if let r { error = r } else { dismiss() }
    }

    private func gradient(_ stops: [PaletteStop]) -> AnyShapeStyle {
        switch stops.count {
        case 0: return AnyShapeStyle(Color.secondary.opacity(0.15))
        case 1: return AnyShapeStyle(Color(rgb: stops[0].rgb))
        default:
            let s = stops.map { Gradient.Stop(color: Color(rgb: $0.rgb), location: Double($0.pos) / 255) }
            return AnyShapeStyle(LinearGradient(stops: s, startPoint: .leading, endPoint: .trailing))
        }
    }
}
