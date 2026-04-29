using System;
using System.Drawing;
using System.Windows.Forms;

namespace MemoQAIHubPlugin
{
    public class MemoQAIHubOptionsForm : Form
    {
        private readonly TextBox _gatewayBaseUrl = new TextBox();
        private readonly NumericUpDown _timeoutMs = new NumericUpDown();
        private readonly CheckBox _enableGateway = new CheckBox();
        private readonly CheckBox _enableCustomDisplayName = new CheckBox();
        private readonly TextBox _customDisplayName = new TextBox();
        private readonly TextBox _preferredProfileId = new TextBox();
        private readonly ComboBox _formattingMode = new ComboBox();

        public MemoQAIHubOptions Options { get; private set; }

        public MemoQAIHubOptionsForm(MemoQAIHubOptions options)
        {
            Options = options;
            Text = "memoQ AI Hub Options";
            Width = 540;
            Height = 360;
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            MinimizeBox = false;
            StartPosition = FormStartPosition.CenterParent;

            _formattingMode.DropDownStyle = ComboBoxStyle.DropDownList;
            _formattingMode.Items.AddRange(new object[]
            {
                FormattingAndTagsUsageOption.BothFormattingAndTags,
                FormattingAndTagsUsageOption.OnlyFormatting,
                FormattingAndTagsUsageOption.Plaintext
            });
            _formattingMode.SelectedItem = FormattingAndTagsUsageOption.BothFormattingAndTags;
            _gatewayBaseUrl.Dock = DockStyle.Fill;
            _customDisplayName.Dock = DockStyle.Fill;
            _preferredProfileId.Dock = DockStyle.Fill;
            _formattingMode.Dock = DockStyle.Fill;

            var table = new TableLayoutPanel
            {
                Dock = DockStyle.Fill,
                ColumnCount = 2,
                RowCount = 8,
                Padding = new Padding(16)
            };
            table.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 36));
            table.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 64));

            table.Controls.Add(new Label { Text = "Gateway Base URL", AutoSize = true }, 0, 0);
            table.Controls.Add(_gatewayBaseUrl, 1, 0);
            table.Controls.Add(new Label { Text = "Timeout (ms)", AutoSize = true }, 0, 1);
            table.Controls.Add(_timeoutMs, 1, 1);
            table.Controls.Add(new Label { Text = "Enable Gateway", AutoSize = true }, 0, 2);
            table.Controls.Add(_enableGateway, 1, 2);
            table.Controls.Add(new Label { Text = "Enable Custom Name", AutoSize = true }, 0, 3);
            table.Controls.Add(_enableCustomDisplayName, 1, 3);
            table.Controls.Add(new Label { Text = "Custom Display Name", AutoSize = true }, 0, 4);
            table.Controls.Add(_customDisplayName, 1, 4);
            table.Controls.Add(new Label { Text = "Default Profile ID", AutoSize = true }, 0, 5);
            table.Controls.Add(_preferredProfileId, 1, 5);
            table.Controls.Add(new Label { Text = "Formatting Mode", AutoSize = true }, 0, 6);
            table.Controls.Add(_formattingMode, 1, 6);

            var buttons = new FlowLayoutPanel
            {
                Dock = DockStyle.Fill,
                FlowDirection = FlowDirection.RightToLeft
            };
            var okButton = new Button { Text = "OK", DialogResult = DialogResult.OK };
            var cancelButton = new Button { Text = "Cancel", DialogResult = DialogResult.Cancel };
            buttons.Controls.Add(okButton);
            buttons.Controls.Add(cancelButton);
            table.Controls.Add(buttons, 0, 7);
            table.SetColumnSpan(buttons, 2);

            Controls.Add(table);
            AcceptButton = okButton;
            CancelButton = cancelButton;

            _timeoutMs.Minimum = 1000;
            _timeoutMs.Maximum = 600000;
            ApplyFieldSizing();

            Load += OnLoad;
            okButton.Click += OnSave;
        }

        private void OnLoad(object sender, EventArgs e)
        {
            _gatewayBaseUrl.Text = Options.GeneralSettings.GatewayBaseUrl;
            _timeoutMs.Value = Math.Max(120000, Options.GeneralSettings.GatewayTimeoutMs);
            _enableGateway.Checked = Options.GeneralSettings.EnableGateway;
            _enableCustomDisplayName.Checked = Options.GeneralSettings.EnableCustomDisplayName;
            _customDisplayName.Text = Options.GeneralSettings.CustomDisplayName;
            _preferredProfileId.Text = Options.GeneralSettings.PreferredProfileId;
            _formattingMode.SelectedItem = Enum.IsDefined(typeof(FormattingAndTagsUsageOption), Options.GeneralSettings.FormattingAndTagUsage)
                ? Options.GeneralSettings.FormattingAndTagUsage
                : FormattingAndTagsUsageOption.BothFormattingAndTags;
        }

        private void OnSave(object sender, EventArgs e)
        {
            Options = new MemoQAIHubOptions(
                new MemoQAIHubGeneralSettings
                {
                    GatewayBaseUrl = _gatewayBaseUrl.Text.Trim(),
                    GatewayTimeoutMs = Decimal.ToInt32(_timeoutMs.Value),
                    EnableGateway = _enableGateway.Checked,
                    EnableCustomDisplayName = _enableCustomDisplayName.Checked,
                    CustomDisplayName = _customDisplayName.Text.Trim(),
                    PreferredProfileId = _preferredProfileId.Text.Trim(),
                    FormattingAndTagUsage = _formattingMode.SelectedItem is FormattingAndTagsUsageOption mode ? mode : FormattingAndTagsUsageOption.BothFormattingAndTags
                },
                new MemoQAIHubSecureSettings()
            );
        }

        private void ApplyFieldSizing()
        {
            var comboMinimumWidth = GetLongestComboWidth(_formattingMode);
            var baselineWidth = Math.Max(280, comboMinimumWidth);
            var minimumFieldSize = new Size(baselineWidth, 0);

            _gatewayBaseUrl.MinimumSize = minimumFieldSize;
            _customDisplayName.MinimumSize = minimumFieldSize;
            _preferredProfileId.MinimumSize = minimumFieldSize;
            _formattingMode.MinimumSize = minimumFieldSize;
            _formattingMode.DropDownWidth = comboMinimumWidth;
            MinimumSize = new Size(520, Height);
        }

        private static int GetLongestComboWidth(ComboBox comboBox)
        {
            var widest = comboBox.Width;
            foreach (var item in comboBox.Items)
            {
                var text = Convert.ToString(item) ?? string.Empty;
                var measured = TextRenderer.MeasureText(text, comboBox.Font).Width;
                widest = Math.Max(widest, measured + SystemInformation.VerticalScrollBarWidth + 32);
            }

            return widest;
        }
    }
}
