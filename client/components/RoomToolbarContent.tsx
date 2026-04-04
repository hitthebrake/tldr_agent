import {
	ArrowDownToolbarItem,
	ArrowLeftToolbarItem,
	ArrowRightToolbarItem,
	ArrowToolbarItem,
	ArrowUpToolbarItem,
	AssetToolbarItem,
	CheckBoxToolbarItem,
	CloudToolbarItem,
	DiamondToolbarItem,
	DrawToolbarItem,
	EllipseToolbarItem,
	EraserToolbarItem,
	FrameToolbarItem,
	HandToolbarItem,
	HeartToolbarItem,
	HexagonToolbarItem,
	HighlightToolbarItem,
	LaserToolbarItem,
	LineToolbarItem,
	NoteToolbarItem,
	OvalToolbarItem,
	RectangleToolbarItem,
	RhombusToolbarItem,
	SelectToolbarItem,
	StarToolbarItem,
	TextToolbarItem,
	TriangleToolbarItem,
	XBoxToolbarItem,
} from 'tldraw'
import { HiggsfieldToolbarItem } from './HiggsfieldToolbarItem'

/**
 * Same order as tldraw's DefaultToolbarContent, with Higgsfield directly after the asset (image) tool.
 */
export function RoomToolbarContent() {
	return (
		<>
			<SelectToolbarItem />
			<HandToolbarItem />
			<DrawToolbarItem />
			<EraserToolbarItem />
			<ArrowToolbarItem />
			<TextToolbarItem />
			<NoteToolbarItem />
			<AssetToolbarItem />
			<HiggsfieldToolbarItem />

			<RectangleToolbarItem />
			<EllipseToolbarItem />
			<TriangleToolbarItem />
			<DiamondToolbarItem />

			<HexagonToolbarItem />
			<OvalToolbarItem />
			<RhombusToolbarItem />
			<StarToolbarItem />

			<CloudToolbarItem />
			<HeartToolbarItem />
			<XBoxToolbarItem />
			<CheckBoxToolbarItem />

			<ArrowLeftToolbarItem />
			<ArrowUpToolbarItem />
			<ArrowDownToolbarItem />
			<ArrowRightToolbarItem />

			<LineToolbarItem />
			<HighlightToolbarItem />
			<LaserToolbarItem />
			<FrameToolbarItem />
		</>
	)
}
