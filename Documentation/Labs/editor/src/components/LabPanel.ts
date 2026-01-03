/**
 * Lab Panel Component
 *
 * A panel for displaying lab demonstrations with tabs for different features.
 * This is where we'll showcase each lab's functionality.
 */

export interface LabTab {
  id: string;
  label: string;
  render: (container: HTMLElement) => void;
  dispose?: () => void;
}

export class LabPanel {
  private container: HTMLElement;
  private tabs: LabTab[] = [];
  private activeTabId: string | null = null;
  private contentContainer: HTMLElement | null = null;

  constructor(container: HTMLElement) {
    this.container = container;
    this.container.className = 'lab-panel';
    this.render();
  }

  /**
   * Register a lab tab
   */
  registerTab(tab: LabTab): void {
    this.tabs.push(tab);
    if (!this.activeTabId) {
      this.activeTabId = tab.id;
    }
    this.render();
  }

  /**
   * Remove a lab tab
   */
  unregisterTab(id: string): void {
    const index = this.tabs.findIndex(t => t.id === id);
    if (index !== -1) {
      const tab = this.tabs[index];
      tab.dispose?.();
      this.tabs.splice(index, 1);
      if (this.activeTabId === id) {
        this.activeTabId = this.tabs[0]?.id ?? null;
      }
      this.render();
    }
  }

  /**
   * Switch to a specific tab
   */
  switchToTab(id: string): void {
    if (this.tabs.find(t => t.id === id)) {
      this.activeTabId = id;
      this.render();
    }
  }

  /**
   * Get active tab
   */
  getActiveTab(): string | null {
    return this.activeTabId;
  }

  private render(): void {
    this.container.innerHTML = '';

    // Header with tabs
    const header = document.createElement('div');
    header.className = 'lab-panel-header';

    const title = document.createElement('span');
    title.className = 'lab-panel-title';
    title.textContent = 'LAB DEMOS';
    header.appendChild(title);

    const tabsContainer = document.createElement('div');
    tabsContainer.className = 'lab-tabs';

    for (const tab of this.tabs) {
      const tabElement = document.createElement('button');
      tabElement.className = `lab-tab ${tab.id === this.activeTabId ? 'active' : ''}`;
      tabElement.textContent = tab.label;
      tabElement.onclick = () => this.switchToTab(tab.id);
      tabsContainer.appendChild(tabElement);
    }

    header.appendChild(tabsContainer);
    this.container.appendChild(header);

    // Content area
    this.contentContainer = document.createElement('div');
    this.contentContainer.className = 'lab-panel-content';

    const activeTab = this.tabs.find(t => t.id === this.activeTabId);
    if (activeTab) {
      activeTab.render(this.contentContainer);
    } else {
      this.contentContainer.innerHTML = `
        <div class="lab-empty">
          <p>No lab demos registered yet.</p>
          <p>Labs will appear here as you progress through the course.</p>
        </div>
      `;
    }

    this.container.appendChild(this.contentContainer);
  }

  /**
   * Refresh current tab content
   */
  refresh(): void {
    if (this.contentContainer && this.activeTabId) {
      this.contentContainer.innerHTML = '';
      const activeTab = this.tabs.find(t => t.id === this.activeTabId);
      activeTab?.render(this.contentContainer);
    }
  }
}
