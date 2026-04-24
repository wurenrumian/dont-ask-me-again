export interface SelectionMenuLayoutInput {
  anchorLeft: number;
  anchorTop: number;
  hostWidth: number;
  horizontalPadding?: number;
  buttonWidth?: number;
  minMenuWidth?: number;
}

export interface SelectionMenuLayout {
  actionLeft: number;
  actionTop: number;
  menuLeft: number;
  menuWidth: number;
  placement: "left" | "right";
}

export function calculateSelectionMenuLayout(
  input: SelectionMenuLayoutInput
): SelectionMenuLayout {
  const horizontalPadding = input.horizontalPadding ?? 16;
  const buttonWidth = input.buttonWidth ?? 36;
  const minMenuWidth = input.minMenuWidth ?? 220;
  const maxMenuWidth = Math.max(0, input.hostWidth - horizontalPadding * 2);
  const menuWidth = Math.min(
    Math.max(Math.round(input.hostWidth / 3), minMenuWidth),
    maxMenuWidth
  );
  const placement: "left" | "right" = input.anchorLeft < input.hostWidth / 2 ? "right" : "left";

  let menuLeft = placement === "right"
    ? input.anchorLeft
    : input.anchorLeft - menuWidth;

  if (placement === "right" && menuLeft + menuWidth > input.hostWidth - horizontalPadding) {
    menuLeft = input.hostWidth - horizontalPadding - menuWidth;
  }

  if (placement === "left" && menuLeft < horizontalPadding) {
    menuLeft = horizontalPadding;
  }

  const actionLeft = Math.min(
    Math.max(input.anchorLeft, horizontalPadding),
    Math.max(horizontalPadding, input.hostWidth - horizontalPadding - buttonWidth)
  );

  return {
    actionLeft,
    actionTop: input.anchorTop,
    menuLeft,
    menuWidth,
    placement
  };
}
