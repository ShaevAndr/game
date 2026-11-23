import { worldBuildingRecipes } from '@game/core';
import { Modal } from '../../../shared/ui/Modal';
import type { useWorldControls } from '../model/useWorldControls';

interface Props {
  controls: ReturnType<typeof useWorldControls>;
  onInventory: () => void;
}

export function WorldLoadout({ controls, onInventory }: Props) {
  const { tool, recipe, menu, setMenu, blockType, tools, setToolId, amount, itemName,
    recipeId, setRecipeId, canBuild, flaskCount } = controls;
  return <>
        <div className="world-hotbar" aria-label="Действия мыши">
          <div><strong><span>ЛКМ</span> Бить</strong><button className="ghost" onClick={() => setMenu('tools')} aria-label="Выбрать инструмент">{tool?.name ?? 'Выбрать инструмент'} <span>⌄</span></button></div>
          <div><strong><span>ПКМ</span> {blockType?.liquid ? 'Набрать воду' : 'Строить'}</strong>{blockType?.liquid
            ? <small>Пустых фляг в рюкзаке: {flaskCount}</small>
            : <button className="ghost" onClick={() => setMenu('buildings')} aria-label="Выбрать строение" title={canBuild ? 'Выбрать строение' : 'Не хватает материалов — открой выбор строения'}>{recipe.name} <span>⌄</span></button>}</div>
          <button className="ghost" onClick={onInventory}>Инвентарь · I</button>
        </div>
        {menu === 'tools' && <Modal title="Выбор инструмента" onClose={() => setMenu(null)}><p className="hint">{blockType ? `Для объекта «${blockType.name}»` : 'Инструменты из основного рюкзака. Наведи прицел на объект, чтобы отфильтровать подходящие.'}</p>
          <div className="world-tool-list">{tools.length ? tools.map(entry => <button key={entry.id} disabled={entry.reserved} aria-pressed={tool?.id === entry.id} onClick={() => { setToolId(entry.id); setMenu(null); }}>{entry.name}{entry.reserved ? ' · занят' : tool?.id === entry.id ? ' ✓' : ''}</button>) : <p>В рюкзаке нет допустимого инструмента для этого объекта.</p>}</div></Modal>}
        {menu === 'buildings' && <Modal title="Выбор строения" onClose={() => setMenu(null)}><p className="hint">Материалы из основного рюкзака спишутся после установки через ПКМ.</p><div className="world-building-list">{worldBuildingRecipes.map(entry => <article className="panel" key={entry.id}><h3>{entry.name}</h3>{entry.ingredients.map(cost => <p key={cost.itemId} className={amount(cost.itemId) < cost.quantity ? 'missing' : ''}>{itemName(cost.itemId)}: {amount(cost.itemId)} / {cost.quantity}</p>)}<button aria-pressed={recipeId === entry.id} onClick={() => { setRecipeId(entry.id); setMenu(null); }}>{recipeId === entry.id ? 'Выбрано ✓' : 'Выбрать'}</button></article>)}</div></Modal>}
  </>;
}
